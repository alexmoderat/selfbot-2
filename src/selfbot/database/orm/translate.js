// Uebersetzt die bisher genutzten Abfragen (Filter, Updates, Aggregationen im Mongo-Stil) in SQL fuer Postgres.
// Nur der tatsaechlich benutzte Teil ist umgesetzt; alles andere wirft einen Fehler, statt still etwas Falsches zu tun.
// Werte gehen immer als Parameter ($1, $2, ...) in die Abfrage, Namen werden nur aus den Schemas oder nach Pruefung eingesetzt.

const quote = (name) => `"${String(name).replaceAll('"', '""')}"`;

class Params {
	values = [];

	add(value) {
		this.values.push(value);
		return `$${this.values.length}`;
	}
}

const NUL = /\u0000/g;

const isPlainObject = (value) => value !== null && typeof value === 'object' && !Array.isArray(value) && !(value instanceof Date) && !(value instanceof RegExp);
const isOperatorObject = (value) => isPlainObject(value) && Object.keys(value).length > 0 && Object.keys(value).every((key) => key.startsWith('$'));

/** Wert fuer eine Spalte: JSON-Spalten als Text, NUL-Zeichen raus (Postgres lehnt sie ab), undefined -> NULL */
const toDb = (field, value) => {
	if (value === undefined || value === null) {
		return null;
	}
	if (field?.json) {
		return JSON.stringify(value).replaceAll(String.raw`\u0000`, '');
	}
	return typeof value === 'string' ? value.replace(NUL, '') : value;
};

const PATH_PART = /^[\w-]+$/;

/** Spaltenname, bei ON CONFLICT mit Tabellenalias davor (sonst "mehrdeutig" gegen EXCLUDED) */
const columnRef = (ctx, name) => (ctx.qualifier ? `${ctx.qualifier}.${quote(name)}` : quote(name));

/** Feld oder Pfad ("data.administrator") -> { field, sql, dotted, path } */
const resolve = (ctx, path) => {
	const [base, ...rest] = String(path).split('.');
	const field = ctx.fields?.get(base);
	if (!field) {
		if (ctx.loose && rest.length === 0) {
			return { field: null, sql: columnRef(ctx, base), dotted: false, path: [] };
		}
		throw new Error(`Unbekanntes Feld: ${path}`);
	}
	if (rest.length === 0) {
		return { field, sql: columnRef(ctx, base), dotted: false, path: [] };
	}
	if (!field.json || rest.some((part) => !PATH_PART.test(part))) {
		throw new Error(`Ungueltiger Pfad: ${path}`);
	}
	return { field, sql: `(${columnRef(ctx, base)}#>'{${rest.join(',')}}')`, dotted: true, path: rest, base };
};

/** Parameter fuer einen Vergleich mit dieser Spalte (bei Pfaden und JSON-Spalten als jsonb) */
const literal = (ctx, ref, value) => {
	if (ref.dotted) {
		return `${ctx.params.add(JSON.stringify(value ?? null))}::jsonb`;
	}
	if (ref.field?.json) {
		return `${ctx.params.add(toDb(ref.field, value))}::jsonb`;
	}
	const param = ctx.params.add(toDb(ref.field, value));
	return ref.field ? `${param}::${ref.field.pg}` : param;
};

const regexSql = (ctx, sql, regex, negate = false) => {
	const operator = `${negate ? '!' : ''}${regex.flags.includes('i') ? '~*' : '~'}`;
	return `${sql}::text ${operator} ${ctx.params.add(regex.source)}`;
};

/* ---------- Filter ---------- */

const typeCondition = (type, sql) => {
	if (['string', 'number', 'date', 'bool', 'boolean', 'int', 'long', 'double', 'object', 'array'].includes(type)) {
		return `${sql} IS NOT NULL`;
	}
	throw new Error(`$type ${type} nicht unterstuetzt`);
};

const equality = (ctx, ref, value) => {
	if (value === null || value === undefined) {
		return ref.dotted ? `(${ref.sql} IS NULL OR ${ref.sql} = 'null'::jsonb)` : `${ref.sql} IS NULL`;
	}
	if (value instanceof RegExp) {
		return regexSql(ctx, ref.sql, value);
	}
	if (ref.field?.array && !ref.dotted && !Array.isArray(value)) {
		return `${ref.sql} @> ${ctx.params.add(JSON.stringify([value]))}::jsonb`;
	}
	return `${ref.sql} = ${literal(ctx, ref, value)}`;
};

const inList = (ctx, ref, list) => {
	const values = list.filter((i) => i !== null && i !== undefined && !(i instanceof RegExp));
	const parts = [];
	if (values.length > 0) {
		if (ref.dotted || ref.field?.json || !ref.field) {
			parts.push(...values.map((i) => equality(ctx, ref, i)));
		} else {
			parts.push(`${ref.sql} = ANY(${ctx.params.add(values.map((i) => toDb(ref.field, i)))}::${ref.field.pg}[])`);
		}
	}
	if (list.some((i) => i === null || i === undefined)) {
		parts.push(equality(ctx, ref, null));
	}
	for (const regex of list.filter((i) => i instanceof RegExp)) {
		parts.push(regexSql(ctx, ref.sql, regex));
	}
	return parts.length > 0 ? `(${parts.join(' OR ')})` : 'FALSE';
};

const operatorCondition = (ctx, ref, operators) => {
	const parts = [];
	for (const [operator, value] of Object.entries(operators)) {
		switch (operator) {
			case '$eq':
				parts.push(equality(ctx, ref, value));
				break;
			case '$ne':
				if (value === null) {
					parts.push(ref.dotted ? `(${ref.sql} IS NOT NULL AND ${ref.sql} <> 'null'::jsonb)` : `${ref.sql} IS NOT NULL`);
				} else if (value instanceof RegExp) {
					parts.push(`(${ref.sql} IS NULL OR ${regexSql(ctx, ref.sql, value, true)})`);
				} else {
					parts.push(`${ref.sql} IS DISTINCT FROM ${literal(ctx, ref, value)}`);
				}
				break;
			case '$gt':
			case '$gte':
			case '$lt':
			case '$lte':
				parts.push(`${ref.sql} ${{ $gt: '>', $gte: '>=', $lt: '<', $lte: '<=' }[operator]} ${literal(ctx, ref, value)}`);
				break;
			case '$in':
				parts.push(inList(ctx, ref, value));
				break;
			case '$nin':
				parts.push(`NOT ${inList(ctx, ref, value)}`);
				break;
			case '$exists':
				parts.push(value ? `${ref.sql} IS NOT NULL` : `${ref.sql} IS NULL`);
				break;
			case '$type':
				parts.push(typeCondition(value, ref.sql));
				break;
			case '$regex':
				parts.push(regexSql(ctx, ref.sql, value instanceof RegExp ? value : new RegExp(value, operators.$options ?? '')));
				break;
			case '$options':
				break;
			case '$not':
				if (value instanceof RegExp) {
					parts.push(`(${ref.sql} IS NULL OR ${regexSql(ctx, ref.sql, value, true)})`);
				} else {
					parts.push(`NOT COALESCE(${operatorCondition(ctx, ref, value)}, FALSE)`);
				}
				break;
			default:
				throw new Error(`Operator ${operator} nicht unterstuetzt`);
		}
	}
	return parts.length === 1 ? parts[0] : `(${parts.join(' AND ')})`;
};

/** Filter-Objekt -> WHERE-Bedingung ('TRUE' bei leerem Filter) */
const compileFilter = (filter, ctx) => {
	const parts = [];
	for (const [key, value] of Object.entries(filter ?? {})) {
		if (key === '$or' || key === '$and' || key === '$nor') {
			const inner = value.map((i) => compileFilter(i, ctx));
			if (inner.length === 0) {
				throw new Error(`${key} braucht mindestens eine Bedingung`);
			}
			parts.push(key === '$or' ? `(${inner.join(' OR ')})` : key === '$and' ? `(${inner.join(' AND ')})` : `NOT (${inner.join(' OR ')})`);
			continue;
		}
		if (key.startsWith('$')) {
			throw new Error(`Operator ${key} nicht unterstuetzt`);
		}
		const ref = resolve(ctx, key);
		parts.push(isOperatorObject(value) ? operatorCondition(ctx, ref, value) : equality(ctx, ref, value));
	}
	return parts.length === 0 ? 'TRUE' : parts.length === 1 ? parts[0] : `(${parts.join(' AND ')})`;
};

/* ---------- Ausdruecke (Updates mit Pipeline, Aggregationen) ---------- */

const operands = (node) => (Array.isArray(node) ? node : [node]);

const expression = (node, ctx) => {
	if (node === null || node === undefined) {
		return 'NULL';
	}
	if (typeof node === 'string') {
		if (node.startsWith('$') && !node.startsWith('$$')) {
			return ctx.insert ? 'NULL' : resolve(ctx, node.slice(1)).sql;
		}
		return `${ctx.params.add(node.replace(NUL, ''))}::text`;
	}
	if (typeof node === 'number') {
		return `${ctx.params.add(node)}::double precision`;
	}
	if (typeof node === 'boolean') {
		return `${ctx.params.add(node)}::boolean`;
	}
	if (node instanceof Date) {
		return `${ctx.params.add(node)}::timestamptz`;
	}
	if (!isOperatorObject(node)) {
		return `${ctx.params.add(JSON.stringify(node))}::jsonb`;
	}

	const [operator, argument] = Object.entries(node)[0];
	const args = () => operands(argument).map((i) => expression(i, ctx));
	switch (operator) {
		case '$cond': {
			const [condition, then, otherwise] = Array.isArray(argument) ? argument : [argument.if, argument.then, argument.else];
			return `CASE WHEN ${expression(condition, ctx)} THEN ${expression(then, ctx)} ELSE ${expression(otherwise, ctx)} END`;
		}
		case '$ifNull':
			return `COALESCE(${args().join(', ')})`;
		case '$max':
			return `GREATEST(${args().join(', ')})`;
		case '$min':
			return `LEAST(${args().join(', ')})`;
		case '$gt':
		case '$gte':
		case '$lt':
		case '$lte': {
			const [a, b] = args();
			return `(${a} ${{ $gt: '>', $gte: '>=', $lt: '<', $lte: '<=' }[operator]} ${b})`;
		}
		case '$eq': {
			const [a, b] = args();
			return `(${a} IS NOT DISTINCT FROM ${b})`;
		}
		case '$ne': {
			const [a, b] = args();
			return `(${a} IS DISTINCT FROM ${b})`;
		}
		case '$or':
			return `(${args().join(' OR ')})`;
		case '$and':
			return `(${args().join(' AND ')})`;
		case '$not':
			return `(NOT ${args()[0]})`;
		case '$add':
			return `(${args().join(' + ')})`;
		case '$subtract':
			return `(${args().join(' - ')})`;
		case '$multiply':
			return `(${args().join(' * ')})`;
		case '$toLower':
			return `lower(${args()[0]}::text)`;
		case '$toUpper':
			return `upper(${args()[0]}::text)`;
		case '$concat':
			return `(${args()
				.map((i) => `${i}::text`)
				.join(' || ')})`;
		case '$substrBytes': {
			const [text, start, length] = operands(argument);
			return `substring(${expression(text, ctx)}::text from ${Number(start) + 1} for ${Number(length)})`;
		}
		default:
			throw new Error(`Ausdruck ${operator} nicht unterstuetzt`);
	}
};

/* ---------- Updates ---------- */

const jsonPath = (path) => `'{${path.join(',')}}'`;

/**
 * Update -> { set: Map(Spalte -> SQL fuer UPDATE ... SET), insert: Map(Spalte -> SQL fuer den Upsert-INSERT) }.
 * Operatoren: $set, $setOnInsert, $inc, $max, $min, $unset; Pipeline-Form [{ $set: { feld: Ausdruck } }] mit Ausdruecken.
 * want = { set, insert } bestimmt, welche Seite gebaut wird: nicht benutzte Parameter duerfte Postgres nicht uebergeben bekommen.
 */
const compileUpdate = (update, ctx, want = { set: true, insert: true }) => {
	const set = new Map();
	const insert = new Map();
	const dottedInsert = new Map();
	const once = (build) => {
		let value;
		return () => (value ??= build());
	};

	const setDotted = (ref, value, onlyInsert) => {
		if (!onlyInsert && want.set) {
			let current = set.get(ref.base) ?? `COALESCE(${columnRef(ctx, ref.base)}, '{}'::jsonb)`;
			// jsonb_set legt fehlende Zwischenebenen nicht an, deshalb vorher jede Ebene sicherstellen
			for (let depth = 1; depth < ref.path.length; depth++) {
				const prefix = jsonPath(ref.path.slice(0, depth));
				current = `jsonb_set(${current}, ${prefix}, COALESCE((${current}) #> ${prefix}, '{}'::jsonb), true)`;
			}
			set.set(ref.base, `jsonb_set(${current}, ${jsonPath(ref.path)}, ${ctx.params.add(JSON.stringify(value ?? null))}::jsonb, true)`);
		}
		const target = dottedInsert.get(ref.base) ?? {};
		let node = target;
		ref.path.slice(0, -1).forEach((part) => (node = node[part] ??= {}));
		node[ref.path.at(-1)] = value;
		dottedInsert.set(ref.base, target);
	};

	const stages = Array.isArray(update) ? update : [update];
	const pipeline = Array.isArray(update);
	for (const stage of stages) {
		const operators = Object.keys(stage).some((key) => key.startsWith('$')) ? stage : { $set: stage };
		for (const [operator, fields] of Object.entries(operators)) {
			if (operator === '$unset') {
				if (!want.set) continue;
				for (const name of Array.isArray(fields) ? fields : Object.keys(fields)) {
					const ref = resolve(ctx, name);
					if (ref.dotted) {
						set.set(ref.base, `${set.get(ref.base) ?? columnRef(ctx, ref.base)} #- ${jsonPath(ref.path)}`);
					} else {
						set.set(name, 'NULL');
					}
				}
				continue;
			}
			for (const [name, value] of Object.entries(fields)) {
				const ref = resolve(ctx, name);
				const column = name.split('.')[0];
				if (pipeline && (operator === '$set' || operator === '$addFields')) {
					if (want.set) set.set(column, expression(value, { ...ctx, insert: false }));
					if (want.insert) insert.set(column, expression(value, { ...ctx, insert: true }));
					continue;
				}
				if (ref.dotted) {
					if (operator === '$set' || operator === '$setOnInsert') {
						setDotted(ref, value, operator === '$setOnInsert');
						continue;
					}
					throw new Error(`${operator} mit Pfad ${name} nicht unterstuetzt`);
				}
				const plain = once(() => literal(ctx, ref, value));
				switch (operator) {
					case '$set':
						if (want.set) set.set(column, plain());
						if (want.insert) insert.set(column, plain());
						break;
					case '$setOnInsert':
						if (want.insert) insert.set(column, plain());
						break;
					case '$inc': {
						const amount = once(() => ctx.params.add(Number(value)));
						if (want.set) set.set(column, `COALESCE(${columnRef(ctx, column)}, 0) + ${amount()}`);
						if (want.insert) insert.set(column, amount());
						break;
					}
					case '$max':
					case '$min': {
						const amount = once(() => literal(ctx, ref, value));
						if (want.set) set.set(column, `${operator === '$max' ? 'GREATEST' : 'LEAST'}(${columnRef(ctx, column)}, ${amount()})`);
						if (want.insert) insert.set(column, amount());
						break;
					}
					default:
						throw new Error(`Update-Operator ${operator} nicht unterstuetzt`);
				}
			}
		}
	}
	if (want.insert) {
		for (const [base, value] of dottedInsert) {
			insert.set(base, `${ctx.params.add(JSON.stringify(value))}::jsonb`);
		}
	}
	return { set, insert };
};

/* ---------- Sortierung ---------- */

/** { feld: 1, feld2: -1 } -> ORDER BY wie MongoDB (NULL zuerst bei aufsteigend) */
const compileSort = (sort, ctx) =>
	Object.entries(sort)
		.map(([name, direction]) => `${resolve(ctx, name).sql} ${Number(direction) < 0 ? 'DESC NULLS LAST' : 'ASC NULLS FIRST'}`)
		.join(', ');

/* ---------- Aggregation ---------- */

const accumulator = (spec, ctx) => {
	const [operator, argument] = Object.entries(spec)[0];
	switch (operator) {
		case '$sum':
			return typeof argument === 'number' ? (argument === 1 ? 'count(*)' : `count(*) * ${Number(argument)}`) : `COALESCE(sum(${expression(argument, ctx)}), 0)`;
		case '$min':
			return `min(${expression(argument, ctx)})`;
		case '$max':
			return `max(${expression(argument, ctx)})`;
		case '$avg':
			return `avg(${expression(argument, ctx)})`;
		case '$first':
			return `(array_agg(${expression(argument, ctx)}))[1]`;
		default:
			throw new Error(`Akkumulator ${operator} nicht unterstuetzt`);
	}
};

const groupId = (id, ctx) => {
	if (id === null) {
		return 'NULL';
	}
	if (isPlainObject(id) && !isOperatorObject(id)) {
		return `jsonb_build_object(${Object.entries(id)
			.map(([key, value]) => `'${key.replaceAll(/[^\w]/g, '')}', ${expression(value, ctx)}`)
			.join(', ')})`;
	}
	return expression(id, ctx);
};

/** Pipeline ($match, $group, $sort, $limit, $skip, $project, $sample) -> { text, values } */
const compileAggregate = (table, fields, pipeline) => {
	const params = new Params();
	let ctx = { fields, params, loose: false };
	let source = `SELECT * FROM ${quote(table)}`;
	let state = { where: [], order: null, limit: null, skip: null, project: null };

	const render = (select = '*') => {
		let text = `SELECT ${select} FROM (${source}) AS s`;
		if (state.where.length > 0) text += ` WHERE ${state.where.join(' AND ')}`;
		if (state.order) text += ` ORDER BY ${state.order}`;
		if (state.limit !== null) text += ` LIMIT ${state.limit}`;
		if (state.skip !== null) text += ` OFFSET ${state.skip}`;
		return text;
	};
	const flush = () => {
		source = render(state.project ?? '*');
		state = { where: [], order: null, limit: null, skip: null, project: null };
		ctx = { ...ctx, fields: null, loose: true };
	};

	for (const stage of pipeline) {
		const [name, value] = Object.entries(stage)[0];
		switch (name) {
			case '$match':
				if (state.order || state.limit !== null || state.skip !== null || state.project) flush();
				state.where.push(compileFilter(value, ctx));
				break;
			case '$group': {
				if (state.where.length > 0 || state.order || state.limit !== null || state.project) flush();
				const { _id: id, ...accumulators } = value;
				const columns = [`${groupId(id, ctx)} AS "_id"`, ...Object.entries(accumulators).map(([key, spec]) => `${accumulator(spec, ctx)} AS ${quote(key)}`)];
				source = `SELECT ${columns.join(', ')} FROM (${source}) AS s${id === null ? ' HAVING count(*) > 0' : ' GROUP BY 1'}`;
				ctx = { ...ctx, fields: null, loose: true };
				state = { where: [], order: null, limit: null, skip: null, project: null };
				break;
			}
			case '$sort':
				if (state.limit !== null || state.skip !== null || state.project) flush();
				state.order = compileSort(value, ctx);
				break;
			case '$limit':
				state.limit = Number(value);
				break;
			case '$skip':
				state.skip = Number(value);
				break;
			case '$sample':
				state.order = 'random()';
				state.limit = Number(value.size);
				break;
			case '$project': {
				if (state.project) flush();
				const entries = Object.entries(value);
				const excluded = new Set(entries.filter(([, v]) => v === 0 || v === false).map(([k]) => k));
				const included = entries.filter(([, v]) => !(v === 0 || v === false));
				const select = included.map(([key, v]) => (v === 1 || v === true ? `${quote(key)}` : `${expression(v, ctx)} AS ${quote(key)}`));
				if (!excluded.has('_id') && !included.some(([key]) => key === '_id')) select.unshift('"_id"');
				state.project = select.join(', ');
				break;
			}
			default:
				throw new Error(`Aggregations-Stufe ${name} nicht unterstuetzt`);
		}
	}
	return { text: render(state.project ?? '*'), values: params.values };
};

module.exports = { quote, Params, toDb, resolve, compileFilter, compileUpdate, compileSort, compileAggregate, expression, isOperatorObject, isPlainObject };
