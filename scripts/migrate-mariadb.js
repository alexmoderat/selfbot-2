// Migration MariaDB (selfbot_core) -> MongoDB. Wiederholbar: jede Zeile wird per Upsert ueber ihre ID geschrieben,
// ein zweiter Lauf aktualisiert nur. Am Ende werden Zeilen und Dokumente je Tabelle verglichen.
//
//   yarn migrate            alle Kerntabellen
//   yarn migrate Channel    nur einzelne Tabellen (Namen wie in MariaDB)

const mariadb = require('mariadb');
const { getConfig } = require('../src/config.js');
const DB = require('../src/database/db.js');

const BATCH = 2000;

const bool = (value) => (value === null || value === undefined ? null : Boolean(Number(value)));
const json = (value) => {
	if (value === null || value === undefined || value === '') {
		return null;
	}
	try {
		return JSON.parse(value);
	}
	catch {
		return value;
	}
};
const num = (value) => (value === null || value === undefined ? null : Number(value));

/** Tabellen in Abhaengigkeitsreihenfolge; map wandelt eine Zeile in ein Dokument */
const TABLES = [
	{
		table: 'Channel',
		model: DB.Channel,
		counter: 'channels',
		map: (row) => ({
			_id: num(row.ID),
			name: row.Name,
			twitchId: row.Specific_ID,
			mode: row.Mode,
			description: row.Description,
			linksAllowed: bool(row.Links_Allowed) !== false,
			logging: String(row.Logging ?? '')
				.split(',')
				.filter(Boolean),
			added: row.Added,
		}),
	},
	{
		// Datenschalter wandern in channels.data
		table: 'Channel_Data',
		custom: async (conn) => {
			const rows = await conn.query('SELECT Channel, Property, Value FROM selfbot_core.Channel_Data');
			const byChannel = new Map();
			for (const row of rows) {
				const id = num(row.Channel);
				if (!byChannel.has(id)) {
					byChannel.set(id, {});
				}
				byChannel.get(id)[row.Property] = json(row.Value);
			}
			const ops = [...byChannel].map(([id, data]) => ({ updateOne: { filter: { _id: id }, update: { $set: { data } } } }));
			if (ops.length > 0) {
				await DB.Channel.bulkWrite(ops, { ordered: false });
			}
			const docs = await DB.Channel.countDocuments({ data: { $ne: {} } });
			return { rows: byChannel.size, docs };
		},
	},
	{
		table: 'User_Alias',
		model: DB.User,
		counter: 'users',
		map: (row) => ({ _id: num(row.ID), name: row.Name, twitchId: row.Twitch_ID, startedUsing: row.Started_Using }),
	},
	{
		table: 'User_Alias_Data',
		custom: async (conn) => {
			const rows = await conn.query('SELECT User_Alias, Property, Value FROM selfbot_core.User_Alias_Data');
			const byUser = new Map();
			for (const row of rows) {
				const id = num(row.User_Alias);
				if (!byUser.has(id)) {
					byUser.set(id, {});
				}
				byUser.get(id)[row.Property] = json(row.Value);
			}
			const ops = [...byUser].map(([id, data]) => ({ updateOne: { filter: { _id: id }, update: { $set: { data } } } }));
			if (ops.length > 0) {
				await DB.User.bulkWrite(ops, { ordered: false });
			}
			const docs = await DB.User.countDocuments({ data: { $ne: {} } });
			return { rows: byUser.size, docs };
		},
	},
	{
		table: 'Filter',
		model: DB.Filter,
		counter: 'filters',
		map: (row) => ({
			_id: num(row.ID),
			userId: num(row.User_Alias),
			channelId: num(row.Channel),
			command: row.Command,
			invocation: row.Invocation,
			type: row.Type,
			blockedUser: num(row.Blocked_User),
			data: row.Data,
			active: bool(row.Active),
			response: row.Response,
			reason: row.Reason,
			issuedBy: num(row.Issued_By),
			created: row.Created,
			changed: row.Changed,
			notes: row.Notes,
		}),
	},
	{
		table: 'AFK',
		model: DB.AFK,
		counter: 'afks',
		map: (row) => ({
			_id: num(row.ID),
			userId: num(row.User_Alias),
			started: row.Started,
			ended: row.Ended,
			text: row.Text,
			status: row.Status,
			active: bool(row.Active),
			interruptedId: num(row.Interrupted_ID),
		}),
	},
	{
		table: 'Reminder',
		model: DB.Reminder,
		counter: 'reminders',
		map: (row) => ({
			_id: num(row.ID),
			userFrom: num(row.User_From),
			userTo: num(row.User_To),
			channelId: num(row.Channel),
			type: row.Type,
			text: row.Text,
			created: row.Created,
			schedule: row.Schedule,
			privateMessage: bool(row.Private_Message),
		}),
	},
	{
		table: 'Reminder_History',
		model: DB.ReminderHistory,
		// IDs teilen sich die Reminder-Zaehlung (History behaelt die ID des Reminders)
		counter: 'reminders',
		map: (row) => ({
			_id: num(row.ID),
			userFrom: num(row.User_From),
			userTo: num(row.User_To),
			channelId: num(row.Channel),
			type: row.Type,
			text: row.Text,
			created: row.Created,
			schedule: row.Schedule,
			privateMessage: bool(row.Private_Message),
			cancelled: bool(row.Cancelled),
		}),
	},
	{
		table: 'Banphrase',
		model: DB.Banphrase,
		counter: 'banphrases',
		map: (row) => ({ _id: num(row.ID), code: row.Code, type: row.Type, channelId: num(row.Channel), priority: num(row.Priority) ?? 0, description: row.Description }),
	},
	{
		table: 'Channel_Chat_Module',
		custom: async (conn) => {
			const rows = await conn.query('SELECT Channel, Chat_Module, Specific_Arguments FROM selfbot_core.Channel_Chat_Module');
			const ops = rows.map((row) => ({
				updateOne: {
					filter: { channelId: num(row.Channel), module: row.Chat_Module },
					update: { $set: { args: json(row.Specific_Arguments) } },
					upsert: true,
				},
			}));
			if (ops.length > 0) {
				await DB.ChannelChatModule.bulkWrite(ops, { ordered: false });
			}
			return { rows: rows.length, docs: await DB.ChannelChatModule.countDocuments() };
		},
	},
	{
		table: 'Error',
		model: DB.ErrorLog,
		counter: 'errors',
		map: (row) => ({
			_id: num(row.ID),
			type: row.Type,
			origin: row.Origin,
			message: row.Message,
			stack: row.Stack,
			context: json(row.Context),
			arguments: json(row.Arguments),
			timestamp: row.Timestamp,
		}),
	},
	{
		table: 'Command_Execution',
		model: DB.CommandExecution,
		key: 'legacyId',
		map: (row) => ({
			legacyId: num(row.ID),
			userId: num(row.User_Alias),
			command: row.Command,
			channelId: num(row.Channel),
			executed: row.Executed,
			success: bool(row.Success),
			invocation: row.Invocation,
			arguments: (() => {
				const value = json(row.Arguments);
				return Array.isArray(value) ? value.map(String) : [];
			})(),
			result: row.Result,
			executionTime: row.Execution_Time === null ? null : Number(row.Execution_Time),
		}),
	},
];

/** Tabelle in Batches nach ID lesen und per Upsert schreiben */
const copyTable = async (conn, { table, model, map, key = '_id', counter }) => {
	let lastId = 0;
	let rows = 0;
	let maxId = 0;
	for (;;) {
		const batch = await conn.query(`SELECT * FROM selfbot_core.\`${table}\` WHERE ID > ? ORDER BY ID LIMIT ${BATCH}`, [lastId]);
		if (batch.length === 0) {
			break;
		}
		const ops = batch.map((row) => {
			const doc = map(row);
			return { replaceOne: { filter: { [key]: doc[key] }, replacement: doc, upsert: true } };
		});
		await model.bulkWrite(ops, { ordered: false });
		rows += batch.length;
		lastId = Number(batch.at(-1).ID);
		maxId = Math.max(maxId, lastId);
	}

	if (counter && maxId > 0) {
		await DB.ensureCounterAtLeast(counter, maxId);
	}
	return { rows, docs: await model.estimatedDocumentCount() };
};

const main = async () => {
	const config = getConfig();
	const only = process.argv.slice(2);
	const { MARIA_USER, MARIA_PASSWORD, MARIA_HOST } = process.env;
	if (!MARIA_USER || !MARIA_PASSWORD || !MARIA_HOST) {
		throw new Error('MARIA_USER, MARIA_PASSWORD und MARIA_HOST fehlen in .env');
	}

	await DB.connect(config.mongo.uri);
	const conn = await mariadb.createConnection({ host: MARIA_HOST, user: MARIA_USER, password: MARIA_PASSWORD, dateStrings: false, bigIntAsNumber: true });

	try {
		const results = [];
		for (const definition of TABLES) {
			if (only.length > 0 && !only.includes(definition.table)) {
				continue;
			}
			const start = Date.now();
			const result = definition.custom ? await definition.custom(conn) : await copyTable(conn, definition);
			results.push({ Tabelle: definition.table, Zeilen: result.rows, Dokumente: result.docs, Sekunden: ((Date.now() - start) / 1000).toFixed(1) });
		}
		console.table(results);
	}
	finally {
		await conn.end();
		await DB.disconnect();
	}
};

main().catch((e) => {
	console.error('Migration fehlgeschlagen', e);
	process.exit(1);
});
