// Erzeugt src/database/models/data-specs.js aus den CREATE-TABLE-Dateien von selfbot (selfbot_data).
// Einmalig fuer die Umstellung; danach wird data-specs.js von Hand gepflegt.
//
//   node scripts/generate-data-specs.js /root/selfbot/init/definitions/selfbot_data/tables

const { readdirSync, readFileSync, writeFileSync } = require('node:fs');
const path = require('node:path');

const dir = process.argv[2];
if (!dir) {
	throw new Error('Pfad zu den SQL-Dateien fehlt');
}

/** "User_ID" -> "userId", "ID" -> "_id", "UUID" -> "uuid" */
const fieldName = (column) => {
	if (column === 'ID') {
		return '_id';
	}
	return column
		.split('_')
		.map((part, index) => {
			const lower = part.toLowerCase();
			return index === 0 ? lower : lower.charAt(0).toUpperCase() + lower.slice(1);
		})
		.join('');
};

const modelName = (table) => table.replaceAll('_', '');
const collectionName = (table) => {
	const name = modelName(table);
	return name.charAt(0).toLowerCase() + name.slice(1);
};

const parseType = (definition) => {
	const upper = definition.toUpperCase();
	if (/^TINYINT\(1\)/.test(upper)) {
		return { type: 'Boolean' };
	}
	if (/^(TINYINT|SMALLINT|MEDIUMINT|INT|BIGINT|DECIMAL|DOUBLE|FLOAT)/.test(upper)) {
		return { type: 'Number' };
	}
	if (/^(DATETIME|TIMESTAMP|DATE\b)/.test(upper)) {
		return { type: 'Date' };
	}
	const enumMatch = /^ENUM\((.*?)\)/i.exec(definition);
	if (enumMatch) {
		return { type: 'String', enum: [...enumMatch[1].matchAll(/'([^']*)'/g)].map((i) => i[1]) };
	}
	if (/^SET\(/.test(upper)) {
		return { type: 'String' };
	}
	return { type: 'String' };
};

const parseDefault = (definition, type) => {
	const match = /DEFAULT\s+('(?:[^']*)'|[^\s,]+)/i.exec(definition);
	if (!match) {
		return undefined;
	}
	const raw = match[1];
	if (/^NULL$/i.test(raw)) {
		return null;
	}
	if (/current_timestamp/i.test(raw)) {
		return 'now';
	}
	const value = raw.replace(/^'|'$/g, '');
	if (type === 'Number') {
		return Number(value);
	}
	if (type === 'Boolean') {
		return value === '1';
	}
	return value;
};

const parseTable = (sql) => {
	const table = /CREATE TABLE IF NOT EXISTS `selfbot_data`\.`([^`]+)`/.exec(sql)[1];
	const comment = /^COMMENT='((?:[^']|'')*)'/m.exec(sql)?.[1]?.replaceAll("''", "'") ?? null;
	const columns = [];
	let primary = [];
	const indexes = [];

	for (const rawLine of sql.split('\n')) {
		const line = rawLine.trim().replace(/,$/, '');
		const column = /^`([^`]+)`\s+(.+)$/.exec(line);
		if (column) {
			const [, name, definition] = column;
			const parsed = parseType(definition);
			const generated = /\bAS\s*\(/i.test(definition);
			const columnComment = /COMMENT\s+'((?:[^']|'')*)'/i.exec(definition)?.[1]?.replaceAll("''", "'") ?? null;
			columns.push({
				column: name,
				field: fieldName(name),
				...parsed,
				nullable: !/NOT NULL/i.test(definition),
				default: parseDefault(definition, parsed.type),
				autoIncrement: /AUTO_INCREMENT/i.test(definition),
				generated,
				comment: columnComment,
			});
			continue;
		}

		const pk = /^PRIMARY KEY \(([^)]*)\)/i.exec(line);
		if (pk) {
			primary = [...pk[1].matchAll(/`([^`]+)`/g)].map((i) => i[1]);
			continue;
		}
		const index = /^(UNIQUE\s+)?(?:INDEX|KEY)\s+`[^`]+`\s*\(([^)]*)\)/i.exec(line);
		if (index) {
			indexes.push({ unique: Boolean(index[1]), columns: [...index[2].matchAll(/`([^`]+)`/g)].map((i) => i[1]) });
		}
	}

	return { table, comment, columns, primary, indexes };
};

const toSpec = ({ table, comment, columns, primary, indexes }) => {
	const field = (column) => columns.find((i) => i.column === column).field;
	const idPrimary = primary.length === 1 && primary[0] === 'ID';
	return {
		table,
		model: modelName(table),
		collection: collectionName(table),
		comment,
		// numerische _id mit Zaehler (wie AUTO_INCREMENT), sonst ObjectId und eindeutiger Schluessel
		counter: idPrimary ? collectionName(table) : null,
		key: idPrimary ? ['_id'] : primary.map(field),
		fields: Object.fromEntries(
			columns
				.filter((i) => !i.generated)
				.map((i) => [
					i.field,
					{
						column: i.column,
						type: i.type,
						...(i.enum ? { enum: i.enum } : {}),
						...(i.nullable ? {} : { required: !(i.default !== undefined || i.autoIncrement) }),
						...(i.default !== undefined ? { default: i.default } : {}),
						...(i.comment ? { comment: i.comment } : {}),
					},
				]),
		),
		indexes: indexes.map((i) => ({ fields: i.columns.map(field), unique: i.unique })),
	};
};

const specs = readdirSync(dir)
	.filter((file) => file.endsWith('.sql'))
	.sort()
	.map((file) => toSpec(parseTable(readFileSync(path.join(dir, file), 'utf8'))));

const header = `// Collections der Features (bisher MariaDB selfbot_data), erzeugt von scripts/generate-data-specs.js und danach von
// Hand gepflegt. Je Collection: Feldname -> { column (Spalte in MariaDB, fuer die Migration), type, ... }.
// key = eindeutiger Schluessel (Upsert-Filter der Migration). counter = numerische _id ueber nextId(counter).
`;

const output = `${header}\nmodule.exports = ${JSON.stringify(specs, null, '\t')
	.replaceAll(/"([a-zA-Z_][a-zA-Z0-9_]*)":/g, '$1:')
	.replaceAll('"', "'")};\n`;
writeFileSync(path.join(__dirname, '..', 'src', 'database', 'models', 'data-specs.js'), output);
console.log(`${specs.length} Collections geschrieben`);
