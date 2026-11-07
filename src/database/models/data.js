const { Schema, model, models } = require('mongoose');
const specs = require('./data-specs.js');

// Models der Feature-Collections aus data-specs.js: bot.DB.WatchStreak, bot.DB.NotifyLive, ...

const TYPES = { String, Number, Boolean, Date, Mixed: Schema.Types.Mixed };

const buildSchema = (spec) => {
	const definition = {};
	for (const [field, info] of Object.entries(spec.fields)) {
		const entry = { type: TYPES[info.type] };
		if (info.enum) {
			entry.enum = [...info.enum, null];
		}
		if (info.default === 'now') {
			entry.default = Date.now;
		} else if (info.default !== undefined) {
			entry.default = info.default;
		} else if (!info.required && field !== '_id') {
			entry.default = null;
		}
		definition[field] = entry;
	}
	if (!spec.counter) {
		delete definition._id;
	}

	const schema = new Schema(definition, { collection: spec.collection, versionKey: false, minimize: false });
	if (!spec.counter && spec.key.length > 0) {
		schema.index(Object.fromEntries(spec.key.map((field) => [field, 1])), { unique: true });
	}
	for (const index of spec.indexes) {
		schema.index(Object.fromEntries(index.fields.map((field) => [field, 1])), { unique: index.unique });
	}
	return schema;
};

const dataModels = {};
for (const spec of specs) {
	dataModels[spec.model] = models[spec.model] ?? model(spec.model, buildSchema(spec));
}

/*
 * Kern-Collections (models/index.js) mit ihren alten Spaltennamen aus selfbot_core, fuer toRow/fromRow und getRow.
 * Feld -> Spalte; counter = Zaehler der numerischen _id.
 */
const CORE_COLUMNS = {
	Channel: {
		counter: 'channels',
		columns: { _id: 'ID', name: 'Name', twitchId: 'Specific_ID', mode: 'Mode', description: 'Description', linksAllowed: 'Links_Allowed', added: 'Added' },
	},
	User: { counter: 'users', columns: { _id: 'ID', name: 'Name', twitchId: 'Twitch_ID', startedUsing: 'Started_Using' } },
	Filter: {
		counter: 'filters',
		columns: {
			_id: 'ID',
			userId: 'User_Alias',
			channelId: 'Channel',
			command: 'Command',
			invocation: 'Invocation',
			type: 'Type',
			blockedUser: 'Blocked_User',
			data: 'Data',
			active: 'Active',
			response: 'Response',
			reason: 'Reason',
			issuedBy: 'Issued_By',
			created: 'Created',
			changed: 'Changed',
			notes: 'Notes',
		},
	},
	AFK: {
		counter: 'afks',
		columns: {
			_id: 'ID',
			userId: 'User_Alias',
			started: 'Started',
			ended: 'Ended',
			text: 'Text',
			status: 'Status',
			active: 'Active',
			interruptedId: 'Interrupted_ID',
		},
	},
	Reminder: {
		counter: 'reminders',
		columns: {
			_id: 'ID',
			userFrom: 'User_From',
			userTo: 'User_To',
			channelId: 'Channel',
			type: 'Type',
			text: 'Text',
			created: 'Created',
			schedule: 'Schedule',
			privateMessage: 'Private_Message',
		},
	},
	ReminderHistory: {
		counter: null,
		columns: {
			_id: 'ID',
			userFrom: 'User_From',
			userTo: 'User_To',
			channelId: 'Channel',
			type: 'Type',
			text: 'Text',
			created: 'Created',
			schedule: 'Schedule',
			privateMessage: 'Private_Message',
			cancelled: 'Cancelled',
		},
	},
	Banphrase: {
		counter: 'banphrases',
		columns: { _id: 'ID', code: 'Code', type: 'Type', channelId: 'Channel', priority: 'Priority', description: 'Description' },
	},
	ErrorLog: {
		counter: 'errors',
		columns: {
			_id: 'ID',
			type: 'Type',
			origin: 'Origin',
			message: 'Message',
			stack: 'Stack',
			context: 'Context',
			arguments: 'Arguments',
			timestamp: 'Timestamp',
		},
	},
	CommandExecution: {
		counter: null,
		columns: {
			userId: 'User_Alias',
			command: 'Command',
			channelId: 'Channel',
			executed: 'Executed',
			success: 'Success',
			invocation: 'Invocation',
			arguments: 'Arguments',
			result: 'Result',
			executionTime: 'Execution_Time',
		},
	},
};

/** [[Feld, Spalte], ...] einer Collection */
const columnsOf = (modelName) => {
	const spec = specs.find((i) => i.model === modelName);
	if (spec) {
		return Object.entries(spec.fields).map(([field, info]) => [field, info.column]);
	}
	const core = CORE_COLUMNS[modelName];
	if (core) {
		return Object.entries(core.columns);
	}
	throw new Error(`Unbekannte Collection ${modelName}`);
};

/** Zaehler einer Collection mit numerischer ID, sonst null */
const counterOf = (modelName) => specs.find((i) => i.model === modelName)?.counter ?? CORE_COLUMNS[modelName]?.counter ?? null;

/*
 * Uebersetzung zwischen den Spaltennamen aus MariaDB und den Feldern in MongoDB. Viele Leser (Commands, Module, Web)
 * arbeiten mit Datensaetzen in der alten Form (row.Cooldown, row.Mod_Only, ID) - die Services liefern sie weiter so.
 */

/** MongoDB-Dokument -> Datensatz mit Spaltennamen ({ ID, Channel, Mod_Only, ... }) */
const toRow = (modelName, doc) => {
	if (!doc) {
		return null;
	}
	const row = {};
	for (const [field, column] of columnsOf(modelName)) {
		row[column] = doc[field] ?? null;
	}
	return row;
};

/** Werte mit Spaltennamen ({ Mod_Only: true }) -> Felder ({ modOnly: true }); unbekannte Namen bleiben stehen */
const fromRow = (modelName, values) => {
	const byColumn = new Map(columnsOf(modelName).map(([field, column]) => [column, field]));
	return Object.fromEntries(Object.entries(values).map(([key, value]) => [byColumn.get(key) ?? key, value]));
};

module.exports = { dataModels, dataSpecs: specs, counterOf, toRow, fromRow };
