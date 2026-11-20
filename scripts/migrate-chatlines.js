// Chat-Logs aus MariaDB (selfbot_chat_line, eine Tabelle je Channel) nach Postgres (chatLines).
// Fortsetzbar: je Channel geht es nach der hoechsten schon uebernommenen legacyId weiter; Dubletten verhindert der
// eindeutige Index { channel, legacyId }. Ein zweiter Lauf uebernimmt nur, was seitdem dazukam (Delta beim Umschalten).
//
//   node --env-file=.env scripts/migrate-chatlines.js            alle Tabellen
//   node --env-file=.env scripts/migrate-chatlines.js ninou2     nur einzelne Channels

const mariadb = require('mariadb');
const { getConfig } = require('../src/selfbot/config.js');
const DB = require('../src/selfbot/database/db.js');

const BATCH = 5000;
const SCHEMA = 'selfbot_chat_line';

const insertBatch = async (docs) => {
	try {
		await DB.ChatLine.insertMany(docs, { ordered: false, lean: true });
		return docs.length;
	} catch (e) {
		// 11000 = schon vorhanden (abgebrochener Lauf) - der Rest des Batches ist trotzdem geschrieben
		const errors = e.writeErrors ?? [];
		if (errors.length > 0 && errors.every((i) => (i.code ?? i.err?.code) === 11000)) {
			return docs.length - errors.length;
		}
		throw e;
	}
};

const copyTable = async (conn, table, channelId) => {
	const last = await DB.ChatLine.findOne({ channel: channelId, legacyId: { $type: 'number' } }, { legacyId: 1 })
		.sort({ legacyId: -1 })
		.lean();
	const fromId = last?.legacyId ?? 0;

	let inserted = 0;
	let read = 0;
	let docs = [];
	const stream = conn.queryStream(`SELECT ID, Platform_ID, Text, Posted FROM ${SCHEMA}.\`${table}\` WHERE ID > ? ORDER BY ID`, [fromId]);
	for await (const row of stream) {
		docs.push({ channel: channelId, userId: String(row.Platform_ID), text: row.Text, posted: row.Posted, legacyId: Number(row.ID) });
		read++;
		// for await liest erst weiter, wenn der Batch geschrieben ist
		if (docs.length >= BATCH) {
			inserted += await insertBatch(docs);
			docs = [];
		}
	}
	if (docs.length > 0) {
		inserted += await insertBatch(docs);
	}
	return { fromId, read, inserted };
};

const main = async () => {
	const config = getConfig();
	const only = process.argv.slice(2).map((i) => i.toLowerCase());
	const { MARIA_USER, MARIA_PASSWORD, MARIA_HOST } = process.env;
	await DB.connect(config.postgres);
	const conn = await mariadb.createConnection({ host: MARIA_HOST, user: MARIA_USER, password: MARIA_PASSWORD, bigIntAsNumber: true });

	try {
		const tables = (await conn.query('SELECT TABLE_NAME AS name FROM information_schema.TABLES WHERE TABLE_SCHEMA = ? ORDER BY TABLE_NAME', [SCHEMA]))
			.map((i) => i.name)
			.filter((name) => only.length === 0 || only.includes(name.toLowerCase()));
		const channels = new Map((await DB.Channel.find({}, { name: 1 }).lean()).map((i) => [i.name.toLowerCase(), i._id]));

		const started = Date.now();
		const summary = { tables: 0, read: 0, inserted: 0, skipped: [] };
		for (const [index, table] of tables.entries()) {
			const channelId = channels.get(table.toLowerCase());
			if (channelId === undefined) {
				summary.skipped.push(table);
				continue;
			}
			const tableStart = Date.now();
			const result = await copyTable(conn, table, channelId);
			summary.tables++;
			summary.read += result.read;
			summary.inserted += result.inserted;
			if (result.read > 0) {
				console.log(`[${index + 1}/${tables.length}] ${table}: ${result.inserted}/${result.read} neu (ab ID ${result.fromId}, ${((Date.now() - tableStart) / 1000).toFixed(1)} s)`);
			}
		}
		console.log(`Fertig in ${((Date.now() - started) / 60_000).toFixed(1)} min: ${summary.tables} Tabellen, ${summary.inserted} Zeilen neu (${summary.read} gelesen)`);
		if (summary.skipped.length > 0) {
			console.log(`Ohne Channel-Eintrag uebersprungen (${summary.skipped.length}): ${summary.skipped.join(', ')}`);
		}
	} finally {
		await conn.end();
		await DB.disconnect();
	}
};

main().catch((e) => {
	console.error('Chat-Log-Migration fehlgeschlagen', e);
	process.exit(1);
});
