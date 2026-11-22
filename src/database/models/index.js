const sql = require('../postgres.js');
const { Mixed } = require('../orm/schema.js');
const { createModel } = require('../orm/model.js');

// Kern-Collections (bisher selfbot_core). Numerische _id wie in MariaDB, damit Verweise bei der Migration
// erhalten bleiben; neue IDs kommen aus der Tabelle "counters" (nextId). Spalten wie die Felder in camelCase.

const registry = new Map();

const define = (name, definition, options = {}, indexes = []) => {
	if (!registry.has(name)) {
		registry.set(name, createModel({ name, collection: options.collection, definition, indexes, sql }));
	}
	return registry.get(name);
};

const Counter = define('Counter', { _id: String, seq: { type: Number, default: 0 } }, { collection: 'counters' });

const Channel = define(
	'Channel',
	{
		_id: Number,
		name: { type: String, required: true },
		twitchId: { type: String, default: null },
		mode: { type: String, enum: ['Inactive', 'Read', 'Write', 'VIP', 'Moderator'], default: 'Write' },
		description: { type: String, default: null },
		linksAllowed: { type: Boolean, default: true },
		/** Wie Supibot: "Lines" = Chat-Zeilen loggen, "Meta" = letzte Nachricht/Zaehler je User */
		logging: { type: [String], default: ['Lines', 'Meta'] },
		added: { type: Date, default: Date.now },
		/** Datenschalter (bisher Channel_Data), siehe services/data-properties.js */
		data: { type: Mixed, default: {} },
	},
	{ collection: 'channels' },
	[
		[{ twitchId: 1 }, { unique: true, partialFilterExpression: { twitchId: { $type: 'string' } } }],
		[{ name: 1 }, {}],
	],
);

const User = define(
	'User',
	{
		_id: Number,
		name: { type: String, required: true },
		twitchId: { type: String, default: null },
		startedUsing: { type: Date, default: Date.now },
		/** Datenschalter (bisher User_Alias_Data) */
		data: { type: Mixed, default: {} },
	},
	{ collection: 'users' },
	[
		[{ name: 1 }, { unique: true }],
		[{ twitchId: 1 }, { unique: true, partialFilterExpression: { twitchId: { $type: 'string' } } }],
	],
);

const CommandExecution = define(
	'CommandExecution',
	{
		userId: Number,
		command: String,
		channelId: { type: Number, default: null },
		executed: Date,
		success: Boolean,
		invocation: String,
		arguments: { type: [String], default: [] },
		result: { type: String, default: null },
		executionTime: { type: Number, default: null },
		/** ID aus MariaDB (Migration), damit ein erneuter Lauf nichts doppelt anlegt */
		legacyId: { type: Number, default: undefined },
	},
	{ collection: 'commandExecutions' },
	[
		[{ legacyId: 1 }, { unique: true, partialFilterExpression: { legacyId: { $type: 'number' } } }],
		[{ userId: 1 }, {}],
		[{ command: 1 }, {}],
		[{ executed: -1 }, {}],
	],
);

const ErrorLog = define(
	'ErrorLog',
	{
		_id: Number,
		type: String,
		origin: { type: String, default: null },
		message: { type: String, default: null },
		stack: { type: String, default: null },
		context: { type: Mixed, default: null },
		arguments: { type: Mixed, default: null },
		timestamp: { type: Date, default: Date.now },
	},
	{ collection: 'errors' },
);

const Filter = define(
	'Filter',
	{
		_id: Number,
		userId: { type: Number, default: null },
		channelId: { type: Number, default: null },
		command: { type: String, default: null },
		invocation: { type: String, default: null },
		type: {
			type: String,
			enum: ['Blacklist', 'Whitelist', 'Opt-out', 'Block', 'Unping', 'Unmention', 'Cooldown', 'Flags', 'Offline-only', 'Online-only', 'Arguments', 'Reminder-prevention'],
			default: 'Blacklist',
		},
		blockedUser: { type: Number, default: null },
		/** JSON-Text wie bisher (Cooldown: multiplier/override, Arguments: args) */
		data: { type: String, default: null },
		active: { type: Boolean, default: true },
		response: { type: String, enum: ['None', 'Auto', 'Reason'], default: 'None' },
		reason: { type: String, default: null },
		issuedBy: { type: Number, default: null },
		created: { type: Date, default: Date.now },
		changed: { type: Date, default: null },
		notes: { type: String, default: null },
	},
	{ collection: 'filters' },
);

const AFK = define(
	'AFK',
	{
		_id: Number,
		userId: { type: Number, required: true },
		started: { type: Date, default: Date.now },
		ended: { type: Date, default: null },
		text: { type: String, default: null },
		status: { type: String, enum: ['afk', 'poop', 'gn', 'brb', 'shower', 'lurk', 'food', 'work', 'nap', 'study'], default: 'afk' },
		active: { type: Boolean, default: true },
		interruptedId: { type: Number, default: null },
	},
	{ collection: 'afks' },
	[
		[{ active: 1 }, {}],
		[{ userId: 1 }, {}],
	],
);

const reminderFields = {
	_id: Number,
	userFrom: { type: Number, default: null },
	userTo: { type: Number, required: true },
	channelId: { type: Number, default: null },
	type: { type: String, enum: ['Reminder', 'Pingme', 'Deferred'], default: 'Reminder' },
	text: { type: String, default: null },
	created: { type: Date, default: Date.now },
	schedule: { type: Date, default: null },
	privateMessage: { type: Boolean, default: false },
};

const Reminder = define('Reminder', reminderFields, { collection: 'reminders' }, [
	[{ userTo: 1 }, {}],
	[{ userFrom: 1 }, {}],
	[{ schedule: 1 }, {}],
]);

const ReminderHistory = define('ReminderHistory', { ...reminderFields, cancelled: { type: Boolean, default: null } }, { collection: 'reminderHistory' }, [
	[{ userTo: 1 }, {}],
	[{ userFrom: 1 }, {}],
]);

const Banphrase = define(
	'Banphrase',
	{
		_id: Number,
		code: { type: String, required: true },
		type: { type: String, enum: ['Denial', 'API response', 'Custom response', 'Replacement', 'Inactive'], default: 'Custom response' },
		channelId: { type: Number, default: null },
		priority: { type: Number, default: 0 },
		description: { type: String, default: null },
	},
	{ collection: 'banphrases' },
);

const ChannelChatModule = define(
	'ChannelChatModule',
	{
		channelId: { type: Number, required: true },
		module: { type: String, required: true },
		args: { type: Mixed, default: null },
	},
	{ collection: 'channelChatModules' },
	[[{ channelId: 1, module: 1 }, { unique: true }]],
);

/** Chat-Zeilen (bisher eine Tabelle je Channel in selfbot_chat_line): channel = Channel-ID, userId = Twitch-User-ID */
const ChatLine = define(
	'ChatLine',
	{
		channel: { type: Number, required: true },
		userId: { type: String, required: true },
		text: { type: String, required: true },
		posted: { type: Date, required: true },
		/** ID aus MariaDB (Migration), je Channel eindeutig */
		legacyId: { type: Number, default: undefined },
	},
	{ collection: 'chatLines' },
	[
		[{ channel: 1, posted: -1 }, {}],
		[{ channel: 1, userId: 1, posted: -1 }, {}],
		[{ userId: 1, posted: -1 }, {}],
		[
			{ channel: 1, legacyId: 1 },
			{ unique: true, partialFilterExpression: { legacyId: { $type: 'number' } } },
		],
	],
);

/**
 * Gelernte Spam-Domains (alexmoderat, 10.11.2026: "eigenes System ... koennen ja nicht staendig neue banphrases adden").
 * _id = Domain; gelernt aus einem manuellen Ban, wenn die letzte Nachricht des Gebannten einen Link enthielt.
 */
const SpamDomain = define(
	'SpamDomain',
	{
		_id: String,
		learnedBy: { type: String, default: null },
		sourceChannel: { type: String, default: null },
		sourceUser: { type: String, default: null },
		sourceMessage: { type: String, default: null },
		created: { type: Date, default: Date.now },
		hits: { type: Number, default: 0 },
		lastHit: { type: Date, default: null },
	},
	{ collection: 'spamDomains' },
);

// Joiner (services/random-joiner.js): Nachrichten aus zufaellig gejointen fremden Channels, 7 Tage
const JoinerMessage = define(
	'JoinerMessage',
	{
		channelId: String,
		channel: String,
		userId: String,
		user: String,
		text: String,
		messageId: String,
		posted: { type: Date, default: Date.now },
	},
	{ collection: 'joinerMessages' },
	[
		[{ posted: 1 }, { expireAfterSeconds: 7 * 24 * 60 * 60 }],
		[{ user: 1, posted: -1 }, {}],
	],
);

// Joiner (services/random-joiner.js): Channels, in denen der Bot gebannt ist (EventSub antwortet 403), wie DontAddThisBots bannedChannels;
// nach 30 Tagen vergessen, damit aufgehobene Banns wieder in die Auswahl kommen
const JoinerBan = define(
	'JoinerBan',
	{
		channelId: { type: String, unique: true },
		channel: String,
		banType: { type: String, default: 'ban' },
		bannedDate: { type: Date, default: Date.now },
	},
	{ collection: 'joinerBans' },
	[[{ bannedDate: 1 }, { expireAfterSeconds: 30 * 24 * 60 * 60 }]],
);

module.exports = {
	Counter,
	Channel,
	User,
	CommandExecution,
	ErrorLog,
	Filter,
	AFK,
	Reminder,
	ReminderHistory,
	Banphrase,
	ChannelChatModule,
	ChatLine,
	SpamDomain,
	JoinerMessage,
	JoinerBan,
};
