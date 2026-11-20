// Abgleich MariaDB gegen Postgres nach einer Migration: exakte Zeilenzahl je Tabelle gegen Dokumente je Collection,
// Chat-Logs je Channel (Anzahl und hoechste ID). Gibt Abweichungen aus, Exit-Code 1 bei Abweichung.
//
//   yarn migrate:check

const mariadb = require('mariadb');
const { getConfig } = require('../src/config.js');
const DB = require('../src/database/db.js');

// Kern-Tabellen mit eigener Collection (Channel_Data/User_Alias_Data liegen in channels.data bzw. users.data)
const CORE = {
	Channel: 'Channel',
	User_Alias: 'User',
	Filter: 'Filter',
	AFK: 'AFK',
	Reminder: 'Reminder',
	Reminder_History: 'ReminderHistory',
	Banphrase: 'Banphrase',
	Channel_Chat_Module: 'ChannelChatModule',
	Error: 'ErrorLog',
};

const main = async () => {
	const config = getConfig();
	const { MARIA_USER, MARIA_PASSWORD, MARIA_HOST } = process.env;
	await DB.connect(config.postgres);
	const conn = await mariadb.createConnection({ host: MARIA_HOST, user: MARIA_USER, password: MARIA_PASSWORD, bigIntAsNumber: true });
	const problems = [];
	const count = async (sql) => Number((await conn.query(sql))[0].c);

	try {
		for (const [table, model] of Object.entries(CORE)) {
			const rows = await count(`SELECT COUNT(*) AS c FROM selfbot_core.\`${table}\``);
			const docs = await DB[model].countDocuments();
			if (rows !== docs) problems.push(`selfbot_core.${table}: ${rows} Zeilen, ${docs} Dokumente`);
		}
		const executions = await count('SELECT COUNT(*) AS c FROM selfbot_core.Command_Execution');
		const migrated = await DB.CommandExecution.countDocuments({ legacyId: { $type: 'number' } });
		if (executions !== migrated) problems.push(`selfbot_core.Command_Execution: ${executions} Zeilen, ${migrated} uebernommen`);

		for (const spec of DB.dataSpecs) {
			// Tabellen neuer Features gibt es nur in Postgres
			const [known] = await conn.query("SELECT COUNT(*) AS c FROM information_schema.TABLES WHERE TABLE_SCHEMA = 'selfbot_data' AND TABLE_NAME = ?", [
				spec.table,
			]);
			if (Number(known.c) === 0) {
				continue;
			}
			const rows = await count(`SELECT COUNT(*) AS c FROM selfbot_data.\`${spec.table}\``);
			const docs = await DB[spec.model].countDocuments();
			if (rows !== docs) problems.push(`selfbot_data.${spec.table}: ${rows} Zeilen, ${docs} Dokumente`);
		}

		const channels = new Map((await DB.Channel.find({}, { name: 1 }).lean()).map((i) => [i.name.toLowerCase(), i._id]));
		const perChannel = new Map(
			(
				await DB.ChatLine.aggregate([
					{ $match: { legacyId: { $type: 'number' } } },
					{ $group: { _id: '$channel', count: { $sum: 1 }, max: { $max: '$legacyId' } } },
				])
			).map((i) => [i._id, i]),
		);
		const tables = (await conn.query("SELECT TABLE_NAME AS name FROM information_schema.TABLES WHERE TABLE_SCHEMA = 'selfbot_chat_line'")).map(
			(i) => i.name,
		);
		let totalRows = 0;
		let totalDocs = 0;
		for (const table of tables) {
			const channelId = channels.get(table.toLowerCase());
			const [row] = await conn.query(`SELECT COUNT(*) AS c, COALESCE(MAX(ID), 0) AS m FROM selfbot_chat_line.\`${table}\``);
			const doc = channelId === undefined ? null : perChannel.get(channelId);
			totalRows += Number(row.c);
			totalDocs += doc?.count ?? 0;
			if (channelId === undefined) {
				problems.push(`selfbot_chat_line.${table}: kein Channel-Eintrag (${row.c} Zeilen)`);
			} else if (Number(row.c) !== (doc?.count ?? 0) || Number(row.m) !== (doc?.max ?? 0)) {
				problems.push(`selfbot_chat_line.${table}: ${row.c} Zeilen (max ${row.m}), ${doc?.count ?? 0} Dokumente (max ${doc?.max ?? 0})`);
			}
		}

		console.log(`Chat-Logs: ${totalRows} Zeilen in ${tables.length} Tabellen, ${totalDocs} Dokumente`);
		if (problems.length === 0) {
			console.log('Alles gleich.');
		} else {
			console.log(`${problems.length} Abweichung(en):`);
			problems.forEach((i) => console.log(`  ${i}`));
			process.exitCode = 1;
		}
	} finally {
		await conn.end();
		await DB.disconnect();
	}
};

main().catch((e) => {
	console.error('Abgleich fehlgeschlagen', e);
	process.exit(1);
});
