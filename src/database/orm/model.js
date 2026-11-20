const { buildFields, defaultOf, buildIndex } = require('./schema.js');
const { quote, Params, toDb, resolve, compileFilter, compileUpdate, compileSort, compileAggregate, isOperatorObject } = require('./translate.js');

// Ein Modell = eine Postgres-Tabelle. Gleiche Bedienung wie bisher bei Mongoose (find/findOne/updateOne/aggregate/...),
// Ergebnisse sind schlichte Objekte mit den Feldnamen als Schluessel (NULL -> null).

/** Zeile -> Dokument; toObject() bleibt fuer Aufrufer erhalten, die es von Mongoose kennen */
const toDoc = (row) => {
	if (row) {
		Object.defineProperty(row, 'toObject', { value: () => ({ ...row }), enumerable: false });
	}
	return row;
};

const MAX_PARAMS = 60_000;

const createModel = ({ name, collection, definition, indexes = [], sql }) => {
	const fields = buildFields(definition);
	const identity = !fields.has('_id');
	if (identity) {
		fields.set('_id', { name: '_id', pg: 'bigint', json: false, identity: true });
	}
	const table = collection;
	const indexList = indexes.map(([keys, options]) => buildIndex(keys, options));
	for (const field of fields.values()) {
		if (field.unique) {
			indexList.push(buildIndex({ [field.name]: 1 }, { unique: true }));
		}
	}
	const uniqueKeys = [['_id'], ...indexList.filter((i) => i.unique && !i.partial).map((i) => i.keys.map((k) => k.field))].map((i) => [...i].sort().join(','));
	const ctxFor = (params) => ({ fields, params });

	const column = (field) => {
		resolve({ fields }, field);
		return quote(field);
	};

	const selectList = (projection) => {
		if (!projection || Object.keys(projection).length === 0) {
			return [...fields.keys()].map(quote).join(', ');
		}
		const entries = Object.entries(projection);
		const exclude = entries.filter(([, v]) => v === 0 || v === false).map(([k]) => k);
		if (exclude.length > 0 && exclude.length === entries.length) {
			return [...fields.keys()].filter((i) => !exclude.includes(i)).map(quote).join(', ');
		}
		const wanted = entries.filter(([, v]) => v !== 0 && v !== false).map(([k]) => k);
		if (!exclude.includes('_id') && !wanted.includes('_id')) wanted.unshift('_id');
		return wanted.map(column).join(', ');
	};

	/* ---------- Lesen ---------- */

	class Query {
		constructor(filter, projection, single) {
			this.filter = filter ?? {};
			this.projection = projection;
			this.single = single;
			this.sortBy = null;
			this.max = single ? 1 : null;
			this.offset = null;
		}

		sort(value) {
			this.sortBy = value;
			return this;
		}

		limit(value) {
			this.max = Number(value);
			return this;
		}

		skip(value) {
			this.offset = Number(value);
			return this;
		}

		select(value) {
			this.projection = value;
			return this;
		}

		lean() {
			return this;
		}

		async exec() {
			const params = new Params();
			const ctx = ctxFor(params);
			let text = `SELECT ${selectList(this.projection)} FROM ${quote(table)} WHERE ${compileFilter(this.filter, ctx)}`;
			if (this.sortBy) text += ` ORDER BY ${compileSort(this.sortBy, ctx)}`;
			if (this.max !== null) text += ` LIMIT ${this.max}`;
			if (this.offset !== null) text += ` OFFSET ${this.offset}`;
			const { rows } = await sql.query(text, params.values);
			rows.forEach(toDoc);
			return this.single ? (rows[0] ?? null) : rows;
		}

		then(resolveFn, rejectFn) {
			return this.exec().then(resolveFn, rejectFn);
		}

		catch(rejectFn) {
			return this.exec().catch(rejectFn);
		}
	}

	const countWhere = async (filter) => {
		const params = new Params();
		const { rows } = await sql.query(`SELECT count(*) AS c FROM ${quote(table)} WHERE ${compileFilter(filter, ctxFor(params))}`, params.values);
		return Number(rows[0].c);
	};

	/* ---------- Schreiben ---------- */

	const checkEnums = (doc) => {
		for (const field of fields.values()) {
			const value = doc[field.name];
			if (field.enum && value !== null && value !== undefined && !field.enum.includes(value)) {
				throw new Error(`${name}.${field.name}: "${value}" ist kein erlaubter Wert`);
			}
		}
	};

	/** Spalte -> SQL-Wert fuer einen neuen Datensatz: Vorgaben (Filter, Update), sonst Standardwert des Schemas */
	const insertValues = (given, params) => {
		const columns = new Map();
		for (const field of fields.values()) {
			if (given.has(field.name)) {
				columns.set(field.name, given.get(field.name));
			} else if (!field.identity) {
				columns.set(field.name, params.add(toDb(field, defaultOf(field))) + (field.json ? '::jsonb' : ''));
			}
		}
		return columns;
	};

	const insertRows = async (docs, { ordered = true, returning = false } = {}) => {
		if (docs.length === 0) return [];
		const withId = docs.some((doc) => doc._id !== undefined && doc._id !== null);
		const used = [...fields.values()].filter((f) => !f.identity || withId);
		const perChunk = Math.max(1, Math.floor(MAX_PARAMS / used.length));
		const result = [];
		for (let i = 0; i < docs.length; i += perChunk) {
			const params = new Params();
			const tuples = docs.slice(i, i + perChunk).map((doc) => {
				checkEnums(doc);
				const cells = used.map((field) => {
					if (field.identity && (doc._id === undefined || doc._id === null)) return 'DEFAULT';
					const value = doc[field.name] === undefined ? defaultOf(field) : doc[field.name];
					return params.add(toDb(field, value)) + (field.json ? '::jsonb' : '');
				});
				return `(${cells.join(', ')})`;
			});
			const text = `INSERT INTO ${quote(table)} (${used.map((f) => quote(f.name)).join(', ')}) VALUES ${tuples.join(', ')}${ordered ? '' : ' ON CONFLICT DO NOTHING'}${returning ? ' RETURNING *' : ''}`;
			const { rows } = await sql.query(text, params.values);
			result.push(...rows.map(toDoc));
		}
		return result;
	};

	/** Gleichheits-Felder des Filters (nur oberste Ebene), null wenn der Filter mehr enthaelt */
	const equalityFilter = (filter) => {
		const found = new Map();
		for (const [key, value] of Object.entries(filter ?? {})) {
			if (key.startsWith('$') || key.includes('.') || value instanceof RegExp || value === undefined) return null;
			if (isOperatorObject(value)) {
				if (Object.keys(value).length === 1 && '$eq' in value) {
					found.set(key, value.$eq);
					continue;
				}
				return null;
			}
			found.set(key, value);
		}
		return found;
	};

	const updateOnly = async (filter, update, one) => {
		const params = new Params();
		const ctx = ctxFor(params);
		const where = compileFilter(filter, ctx);
		const { set } = compileUpdate(update, ctx, { set: true, insert: false });
		if (set.size === 0) {
			const matched = await countWhere(filter);
			return { acknowledged: true, matchedCount: one ? Math.min(1, matched) : matched, modifiedCount: 0, upsertedCount: 0 };
		}
		const assignments = [...set].map(([col, value]) => `${quote(col)} = ${value}`).join(', ');
		const target = one ? `ctid = (SELECT ctid FROM ${quote(table)} WHERE ${where} LIMIT 1)` : where;
		const { rowCount } = await sql.query(`UPDATE ${quote(table)} SET ${assignments} WHERE ${target}`, params.values);
		return { acknowledged: true, matchedCount: rowCount, modifiedCount: rowCount, upsertedCount: 0 };
	};

	const buildInsert = (filter, update, params, qualifier) => {
		const ctx = { ...ctxFor(params), qualifier };
		const { set, insert } = compileUpdate(update, ctx, { set: Boolean(qualifier), insert: true });
		const given = new Map();
		for (const [key, value] of equalityFilter(filter) ?? []) {
			// Wert aus dem Update gewinnt; einen ungenutzten Parameter duerfte Postgres nicht uebergeben bekommen
			if (!insert.has(key)) {
				const field = fields.get(key);
				given.set(key, params.add(toDb(field, value)) + (field.json ? '::jsonb' : ''));
			}
		}
		for (const [col, value] of insert) given.set(col, value);
		const columns = insertValues(given, params);
		return { set, columns };
	};

	const upsert = async (filter, update) => {
		const equality = equalityFilter(filter);
		const key = equality ? [...equality.keys()].sort().join(',') : null;
		if (key && uniqueKeys.includes(key)) {
			// ein Statement: INSERT ... ON CONFLICT (Schluessel) DO UPDATE
			const params = new Params();
			const { set, columns } = buildInsert(filter, update, params, 't');
			const assignments = [...set].map(([col, value]) => `${quote(col)} = ${value}`).join(', ');
			const text = `INSERT INTO ${quote(table)} AS t (${[...columns.keys()].map(quote).join(', ')}) VALUES (${[...columns.values()].join(', ')}) ON CONFLICT (${key.split(',').map(quote).join(', ')}) ${assignments ? `DO UPDATE SET ${assignments}` : 'DO NOTHING'} RETURNING (xmax = 0) AS inserted`;
			const { rows } = await sql.query(text, params.values);
			const inserted = rows[0]?.inserted === true;
			return { acknowledged: true, matchedCount: inserted ? 0 : 1, modifiedCount: inserted ? 0 : 1, upsertedCount: inserted ? 1 : 0 };
		}

		// ohne passenden eindeutigen Schluessel: pro Filter sperren, aktualisieren, sonst einfuegen
		const client = await sql.connect();
		try {
			await client.query('BEGIN');
			await client.query('SELECT pg_advisory_xact_lock(hashtext($1))', [`${table}:${JSON.stringify(filter)}`]);
			const params = new Params();
			const ctx = ctxFor(params);
			const where = compileFilter(filter, ctx);
			const { set } = compileUpdate(update, ctx, { set: true, insert: false });
			let matched = 0;
			if (set.size > 0) {
				const assignments = [...set].map(([col, value]) => `${quote(col)} = ${value}`).join(', ');
				matched = (await client.query(`UPDATE ${quote(table)} SET ${assignments} WHERE ctid = (SELECT ctid FROM ${quote(table)} WHERE ${where} LIMIT 1)`, params.values)).rowCount;
			} else {
				matched = (await client.query(`SELECT 1 FROM ${quote(table)} WHERE ${where} LIMIT 1`, params.values)).rowCount;
			}
			if (matched === 0) {
				const insertParams = new Params();
				const { columns } = buildInsert(filter, update, insertParams);
				await client.query(`INSERT INTO ${quote(table)} (${[...columns.keys()].map(quote).join(', ')}) VALUES (${[...columns.values()].join(', ')})`, insertParams.values);
			}
			await client.query('COMMIT');
			return { acknowledged: true, matchedCount: matched, modifiedCount: matched, upsertedCount: matched === 0 ? 1 : 0 };
		} catch (error) {
			await client.query('ROLLBACK').catch(() => {});
			throw error;
		} finally {
			client.release();
		}
	};

	const remove = async (filter, one) => {
		const params = new Params();
		const where = compileFilter(filter, ctxFor(params));
		const target = one ? `ctid = (SELECT ctid FROM ${quote(table)} WHERE ${where} LIMIT 1)` : where;
		const { rowCount } = await sql.query(`DELETE FROM ${quote(table)} WHERE ${target}`, params.values);
		return { acknowledged: true, deletedCount: rowCount };
	};

	const model = {
		modelName: name,
		collectionName: table,
		fields,

		find: (filter, projection) => new Query(filter, projection, false),
		findOne: (filter, projection) => new Query(filter, projection, true),
		findById: (id, projection) => new Query({ _id: id }, projection, true),

		countDocuments: (filter = {}) => countWhere(filter),

		async estimatedDocumentCount() {
			const { rows } = await sql.query('SELECT reltuples::bigint AS n FROM pg_class WHERE oid = to_regclass($1)', [quote(table)]);
			const estimate = Number(rows[0]?.n ?? -1);
			return estimate >= 0 ? estimate : await countWhere({});
		},

		async exists(filter) {
			const doc = await new Query(filter, { _id: 1 }, true).exec();
			return doc ? { _id: doc._id } : null;
		},

		async distinct(field, filter = {}) {
			const params = new Params();
			const ctx = ctxFor(params);
			const col = column(field);
			const { rows } = await sql.query(`SELECT DISTINCT ${col} AS v FROM ${quote(table)} WHERE ${compileFilter(filter, ctx)} AND ${col} IS NOT NULL`, params.values);
			return rows.map((i) => i.v);
		},

		async aggregate(pipeline) {
			const { text, values } = compileAggregate(table, fields, pipeline);
			return (await sql.query(text, values)).rows;
		},

		async create(doc) {
			return (await insertRows([doc], { returning: true }))[0];
		},

		async insertMany(docs, options = {}) {
			return await insertRows(docs, { ordered: options.ordered !== false, returning: false });
		},

		async updateOne(filter, update, options = {}) {
			return options.upsert ? await upsert(filter, update) : await updateOnly(filter, update, true);
		},

		async updateMany(filter, update, options = {}) {
			return options.upsert ? await upsert(filter, update) : await updateOnly(filter, update, false);
		},

		deleteOne: (filter) => remove(filter, true),
		deleteMany: (filter) => remove(filter ?? {}, false),

		async bulkWrite(operations) {
			const counts = { insertedCount: 0, matchedCount: 0, modifiedCount: 0, deletedCount: 0, upsertedCount: 0 };
			for (const operation of operations) {
				const [kind, spec] = Object.entries(operation)[0];
				if (kind === 'insertOne') {
					await model.create(spec.document);
					counts.insertedCount++;
				} else if (kind === 'updateOne' || kind === 'updateMany') {
					const result = await model[kind](spec.filter, spec.update, { upsert: spec.upsert });
					counts.matchedCount += result.matchedCount;
					counts.modifiedCount += result.modifiedCount;
					counts.upsertedCount += result.upsertedCount;
				} else if (kind === 'replaceOne') {
					const result = await model.updateOne(spec.filter, { $set: spec.replacement }, { upsert: spec.upsert });
					counts.upsertedCount += result.upsertedCount;
				} else if (kind === 'deleteOne' || kind === 'deleteMany') {
					counts.deletedCount += (await model[kind](spec.filter)).deletedCount;
				} else {
					throw new Error(`bulkWrite: ${kind} nicht unterstuetzt`);
				}
			}
			return counts;
		},

		/** Tabelle, fehlende Spalten und Indizes anlegen */
		async init() {
			const defs = [...fields.values()].map((field) => {
				if (field.name === '_id') {
					return `${quote('_id')} ${field.identity ? 'bigint GENERATED BY DEFAULT AS IDENTITY' : field.pg === 'bigint' ? 'bigint' : 'text'} PRIMARY KEY`;
				}
				return `${quote(field.name)} ${field.pg}`;
			});
			await sql.query(`CREATE TABLE IF NOT EXISTS ${quote(table)} (${defs.join(', ')})`);
			for (const field of fields.values()) {
				if (field.name !== '_id') {
					await sql.query(`ALTER TABLE ${quote(table)} ADD COLUMN IF NOT EXISTS ${quote(field.name)} ${field.pg}`);
				}
			}
			for (const index of indexList) {
				const label = `${table}_${index.keys.map((k) => k.field).join('_')}${index.unique ? '_uq' : '_ix'}${index.partial ? '_p' : ''}`.slice(0, 63);
				const cols = index.keys.map((k) => `${quote(k.field)}${k.desc ? ' DESC' : ''}`).join(', ');
				const where = index.partial ? ` WHERE ${index.partial.map((f) => `${quote(f)} IS NOT NULL`).join(' AND ')}` : '';
				await sql.query(`CREATE ${index.unique ? 'UNIQUE ' : ''}INDEX IF NOT EXISTS ${quote(label)} ON ${quote(table)} (${cols})${where}`);
			}
		},

		/** Zeilen, die ueber expireAfterSeconds hinaus alt sind (bisher TTL-Index von MongoDB) */
		async expire() {
			let deleted = 0;
			for (const index of indexList.filter((i) => i.ttl)) {
				const { rowCount } = await sql.query(`DELETE FROM ${quote(table)} WHERE ${quote(index.keys[0].field)} < now() - ($1 * interval '1 second')`, [index.ttl]);
				deleted += rowCount;
			}
			return deleted;
		},
	};
	return model;
};

module.exports = { createModel };
