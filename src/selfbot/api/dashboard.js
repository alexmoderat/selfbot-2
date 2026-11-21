const { Logger } = require('../misc/logger.js');
const { getCommand, commands } = require('../clients/modules/commands.js');

const { Router } = require('express');

const Filter = require('../util/filter.js');

const phrases = require('../util/moderation-phrases.js');

const spamDomains = require('../util/spam-domains.js');

const customCommands = require('../util/custom-commands.js');

const { partChannel } = require('../util/channel-manager.js');

const { resolveStreamer, watchStreamer, watchTitle } = require('../util/notifications.js');

const { cleanHandle, cleanMessage, cleanTimes, accountExists, HANDLE } = require('../util/tweet-notify.js');

const raidNotifier = require('../clients/modules/chat/raid-notifier.js');

const utilityDb = require('../database/utility.js');

const { getPrefix } = require('../clients/modules/handler.js');

const { fetchTwitchUser } = require('../util/twitch/twitch-utils.js');

const { applyLevel, effectiveLevel, parseLevel } = require('../clients/modules/levels.js');

const { setAutobanSwitch } = require('../util/autoban-log.js');

const { BANPHRASE_REASONS, validateBanphraseReason } = require('../util/ban-reason.js');

const { isAdminLogin, requireAdmin, requireSession } = require('./sessions.js');

const { getConfig } = require('../config.js');

const { loadOtherBotCommands } = require('../util/command-listing.js');

/**
 * Dashboard-API aus sb-v2s auth-server.ts (/api/me, /api/admin/*, /api/banphrases, /api/commands, /api/settings/*,
 * /api/notify, /api/banwatch, /api/stats) auf die selfbot-Daten abgebildet:
 *   Banphrases       -> Moderation_Phrase (Channel-/globale Ebene)
 *   Custom Commands  -> Custom_Command
 *   Commands an/aus  -> Supibot-Filter (Blacklist, Antwort "None"): ganzer Channel oder einzelner Command
 *   Moderation       -> Channel_Data autobanDisabled, Crossban -> crossbanOptIn
 *   notify/banwatch  -> Notify_Live / Notify_Ban, Admins -> User_Alias_Data administrator
 *   Blacklist        -> manuell verlassene Channels (Mode Inactive, inactive.reason "manual"), die Auto-Join auslaesst
 * Antwortformen wie in sb-v2, damit dashboard.html unveraendert bleiben kann.
 */

const twitch = () => bot.Twitch;

const findChannel = (name) => bot.Channels.get(name.toLowerCase(), twitch());

const str = (value) => (typeof value === 'string' ? value : '');

const parseDuration = (value) => {
	if (value === null || value === undefined || value === '') {
		return null;
	}
	const duration = Number.parseInt(String(value), 10);
	return Number.isNaN(duration) || duration < 1 || duration > 1_209_600 ? 'invalid' : duration;
};

const phraseRows = (list) => list.map((i) => ({ id: i.ID, phrase: i.Phrase, reason: i.Reason, duration: i.Duration }));

const issuer = async (req) => (await bot.Users.getOrCreate(req.sess?.username ?? twitch().selfName)).ID;

/* ---------- Commands an/aus per Filter ---------- */

const channelBlock = (channel) =>
	[...Filter.data.values()].find((i) => i.Type === 'Blacklist' && i.Channel === channel.id && i.Command === null && i.User_Alias === null && i.Invocation === null && i.Platform === null);

const ownLevel = (command) => (command.Flags.includes('mod') ? 'mod' : 'everyone');

const commandBlock = (channel, command) =>
	[...Filter.data.values()].find((i) => i.Type === 'Blacklist' && i.Channel === channel.id && i.Command === command && i.User_Alias === null && i.Invocation === null);

const setBlock = async (existing, wanted, create) => {
	if (existing) {
		if (existing.Active !== wanted) {
			await existing.toggle();
		}
	} else if (wanted) {
		await create();
	}
};

const channelSettings = async (channel) => ({
	commandsAllowed: !channelBlock(channel)?.Active,
	moderation: (await bot.Channels.getData(channel, 'autobanDisabled')) === true ? 'disabled' : 'automatic',
	crossban: (await bot.Channels.getData(channel, 'crossbanOptIn')) === true,
	// !add/!remove (7tv) nur fuer den Streamer - wie "7tv access streamer|mods" (ninou2, 29.10.2026: auch im Dashboard)
	sevenTvAccess: (await bot.Channels.getData(channel, 'sevenTvStreamerOnly')) === true ? 'streamer' : 'mods',
	// ninou2, 13.11.2026: neue globale Badges im Chat melden, standardmaessig aus, eigener Textteil
	badgeAlerts: (await bot.Channels.getData(channel, 'badgeAlerts'))?.enabled === true,
	badgeAlertsMessage: (await bot.Channels.getData(channel, 'badgeAlerts'))?.message ?? '',
	// Raid Notify (ninou2, 14.11.2026): standardmaessig aus, danach erscheint der Punkt Raid Notify in den Notifications
	raidNotify: (await raidNotifier.getConfig(channel)).enabled,
	raidNotifyActive: await raidActiveCount(channel),
});

// Zahl der eingeschalteten Raid-Benachrichtigungen (0, wenn Raid Notify aus ist) fuer die Seitenleiste
const raidActiveCount = async (channel) => {
	const config = await raidNotifier.getConfig(channel);
	return config.enabled ? config.items.filter((i) => i.on).length : 0;
};

const applyChannelSettings = async (req, channel) => {
	const { commandsAllowed, moderation, crossban, sevenTvAccess, badgeAlerts, badgeAlertsMessage, raidNotify } = req.body;
	if (typeof commandsAllowed === 'boolean') {
		const by = await issuer(req);
		await setBlock(channelBlock(channel), !commandsAllowed, () => Filter.create({ Channel: channel.id, Type: 'Blacklist', Response: 'None', Issued_By: by }));
	}
	if (moderation === 'disabled' || moderation === 'automatic') {
		await setAutobanSwitch(channel, 'autobanDisabled', moderation === 'disabled', req.sess?.username ?? 'dashboard', 'dashboard');
	}
	if (typeof crossban === 'boolean') {
		await bot.Channels.setData(channel, 'crossbanOptIn', crossban);
	}
	if (sevenTvAccess === 'streamer' || sevenTvAccess === 'mods') {
		await bot.Channels.setData(channel, 'sevenTvStreamerOnly', sevenTvAccess === 'streamer');
	}
	if (typeof badgeAlerts === 'boolean' || typeof badgeAlertsMessage === 'string') {
		const current = (await bot.Channels.getData(channel, 'badgeAlerts')) ?? {};
		await bot.Channels.setData(channel, 'badgeAlerts', {
			enabled: typeof badgeAlerts === 'boolean' ? badgeAlerts : current.enabled === true,
			message:
				typeof badgeAlertsMessage === 'string'
					? badgeAlertsMessage
							.replaceAll(/[\r\n]+/g, ' ')
							.trim()
							.slice(0, 200)
					: (current.message ?? ''),
		});
	}
	if (typeof raidNotify === 'boolean') {
		await raidNotifier.setEnabled(channel, raidNotify);
	}
	return await channelSettings(channel);
};

/* ---------- Custom Commands ---------- */

/** Aufrufe je Command im Channel (Command_Execution, seit 23.10.2026) - ninou2, 28.10.2026: auf der Webseite sehen,
 * wie oft die Commands im eigenen Stream benutzt wurden */
/** Aufrufe je User (Name) aus commandExecutions: [{ Name, Uses }] */
const usesByUser = async (match) => {
	const rows = await bot.DB.CommandExecution.aggregate([{ $match: match }, { $group: { _id: '$userId', Uses: { $sum: 1 } } }]);
	const users = await bot.DB.User.find({ _id: { $in: rows.map((i) => i._id) } }, { name: 1 }).lean();
	const names = new Map(users.map((i) => [i._id, i.name]));
	return rows.filter((i) => names.has(i._id)).map((i) => ({ Name: names.get(i._id), Uses: i.Uses }));
};

/** Aufrufe je Command aus commandExecutions: [{ Command, Uses }] */
const executionCounts = async (match) =>
	(await bot.DB.CommandExecution.aggregate([{ $match: match }, { $group: { _id: '$command', Uses: { $sum: 1 } } }])).map((i) => ({
		Command: i._id,
		Uses: i.Uses,
	}));

const usageCounts = async (channel) => {
	const [rows, utility] = await Promise.all([
		executionCounts({ channelId: channel.id }),
		utilityDb.query(`SELECT command AS "Command", COUNT(*) AS "Uses" FROM ${UTILITY_TABLE} WHERE channel = ? GROUP BY command`, [channel.name]),
	]);
	return addUtilityRows(new Map(rows.map((i) => [i.Command, Number(i.Uses)])), utility);
};

/**
 * Aufrufe des utility-bots (chat_data.utility_command_executions, seit 07.11.2026) zaehlen mit - ninou2, 07.11.2026:
 * "commands tab should include all COMMANDS that the [bot] execute, does not matter if its by [the utility-bot]
 * or if it come from the supibot code". Utility-Namen, die bei uns ein Alias sind, laufen unter unserem Namen.
 */
const UTILITY_TABLE = 'command_executions';

/** Unter welchen Namen der utility-bot einen unserer Commands protokolliert haben kann (Name und Aliase) */
const utilityNamesFor = (name) => {
	const command = getCommand(name);
	return command ? [command.Name, ...command.Aliases].map((i) => i.toLowerCase()) : [name.toLowerCase()];
};

const ownName = (name) => {
	const lower = name.toLowerCase();
	return getCommand(lower)?.Name ?? lower;
};

const addUtilityRows = (map, rows) => {
	for (const row of rows) {
		const name = ownName(row.Command);
		map.set(name, (map.get(name) ?? 0) + Number(row.Uses));
	}
	return map;
};

/**
 * Wann ein Command im Channel zuletzt benutzt wurde (ninou2, 14.11.2026: "add to Bot commands, sort by (last used)") - selfbot
 * (commandExecutions) und utility-bot (utility_command_executions, Spalte executed_at). -> Map Name -> ISO-Zeit
 */
const lastUsedCounts = async (channel) => {
	const [own, utility] = await Promise.all([
		bot.DB.CommandExecution.aggregate([{ $match: { channelId: channel.id } }, { $group: { _id: '$command', last: { $max: '$executed' } } }]),
		utilityDb.query(`SELECT command AS "Command", MAX(executed_at) AS "Last" FROM ${UTILITY_TABLE} WHERE channel = ? GROUP BY command`, [channel.name]),
	]);
	const map = new Map();
	const add = (name, value) => {
		const time = value ? new Date(value).getTime() : Number.NaN;
		if (!Number.isNaN(time) && time > (map.get(name) ?? 0)) {
			map.set(name, time);
		}
	};
	for (const row of own) {
		add(row._id, row.last);
	}
	for (const row of utility) {
		add(ownName(row.Command), row.Last);
	}
	return new Map([...map].map(([name, time]) => [name, new Date(time).toISOString()]));
};

/** Aufrufe je Command ueber alle Channels (ninou2, 07.11.2026: "global" neben den eigenen Uses) */
const globalUsageCounts = async () => {
	const [own, utility] = await Promise.all([
		executionCounts({ command: { $not: /^custom:/ } }),
		utilityDb.query(`SELECT command AS "Command", COUNT(*) AS "Uses" FROM ${UTILITY_TABLE} GROUP BY command`),
	]);
	return addUtilityRows(new Map(own.map((i) => [i.Command, Number(i.Uses)])), utility);
};

/** utility-bot-Commands, die der selfbot selbst nicht hat (ohne Owner-Commands) */
const utilityOnlyCommands = () => {
	const dir = getConfig().values.otherBotCommandsDir;
	if (!dir) {
		return [];
	}
	return loadOtherBotCommands(dir).filter((i) => i.permission !== 'owner' && !getCommand(i.Name) && !i.Aliases.some((j) => getCommand(j)));
};

const commandRows = async (channel) => {
	const uses = await usageCounts(channel);
	return (await customCommands.list(channel)).map((i) => ({
		name: i.Name,
		response: i.Response,
		cooldown: i.Cooldown,
		mod_only: Boolean(i.Mod_Only),
		reply: Boolean(i.Reply),
		times: i.Times ? cleanTimes(i.Times) : null,
		uses: uses.get(`custom:${channel.id}:${i.Name.replace(/^!/, '')}`) ?? 0,
		created: i.Created ?? null,
		modified: i.Modified ?? null,
	}));
};

const commandOptions = (body) => ({
	Cooldown: Number(body.cooldown ?? 5) || 0,
	Mod_Only: Boolean(body.mod_only),
	Reply: Boolean(body.reply),
	// Nur fuer !raidping/!raidreminder (ninou2, 14.11.2026: "both commands ... the times feature"); ohne Angabe unveraendert
	...(body.times === undefined || body.times === null ? {} : { Times: cleanTimes(body.times) }),
});

/* ---------- notify / banwatch ---------- */

const notifyRows = async (channel) =>
	(await bot.DB.NotifyLive.find({ channel: channel.id }).sort({ added: 1 }).lean()).map((i) => ({
		streamer: i.streamerLogin,
		message: i.message ?? '',
		times: cleanTimes(i.times),
		added: i.added,
	}));

// message/times nur setzen, wenn angegeben (undefined = unveraendert), damit das Aendern eines Felds das andere nicht ueberschreibt
const addNotify = async (channel, streamerLogin, message, times) => {
	const streamer = await resolveStreamer(streamerLogin);
	if (!streamer) {
		return false;
	}
	await bot.DB.NotifyLive.updateOne(
		{ channel: channel.id, streamerId: streamer.id },
		{
			$set: {
				streamerLogin: streamer.login,
				...(message === undefined ? {} : { message: message || null }),
				...(times === undefined ? {} : { times: cleanTimes(times) }),
			},
			$setOnInsert: { added: new Date() },
		},
		{ upsert: true },
	);
	watchStreamer(streamer.id);
	watchTitle(streamer.id);
	return true;
};

const removeNotify = async (channel, streamer) => {
	await bot.DB.NotifyLive.deleteMany({ channel: channel.id, streamerLogin: streamer.toLowerCase() });
};

const banwatchRows = async (channel) => {
	const rows = (
		await bot.DB.NotifyBan.find(channel ? { channel: channel.id } : {})
			.sort({ added: 1 })
			.lean()
	).map((i) => ({
		Channel: i.channel,
		Login: i.login,
		Message: i.message,
	}));
	return rows.map((i) => ({ channel: bot.Channels.get(i.Channel)?.Name ?? String(i.Channel), login: i.Login, message: i.Message ?? '' }));
};

const addBanwatch = async (channel, login, message) => {
	await bot.DB.NotifyBan.updateOne(
		{ channel: channel.id, login: login.toLowerCase() },
		{ $set: { message: message || null, notified: null }, $setOnInsert: { added: new Date() } },
		{ upsert: true },
	);
};

const removeBanwatch = async (channel, login) => {
	await bot.DB.NotifyBan.deleteMany({ channel: channel.id, login: login.toLowerCase() });
};

/* ---------- Blacklist / Admins ---------- */

const blacklist = async () => {
	const result = [];
	for (const channel of bot.Channels.all()) {
		if (channel.mode === 'Inactive' && (await bot.Channels.getData(channel, 'inactive'))?.reason === 'manual') {
			result.push(channel.name);
		}
	}
	return result.sort();
};

const admins = async () => {
	return (await bot.DB.User.find({ 'data.administrator': true }, { name: 1 }).sort({ name: 1 }).lean()).map((i) => i.name);
};

const route = (handler) => (req, res) => {
	handler(req, res).catch((e) => {
		Logger.warn('[web] Dashboard-Fehler', e);
		res.status(500).json({ error: e instanceof Error ? e.message : String(e) });
	});
};

const sessionChannel = (req, res) => {
	const channel = findChannel(req.sess?.channel ?? '');
	if (!channel) {
		res.status(404).json({ error: 'channel not joined' });
	}
	return channel;
};

const paramChannel = (req, res) => {
	const channel = findChannel(req.params.channel ?? '');
	if (!channel) {
		res.status(404).json({ error: 'channel not found' });
	}
	return channel;
};

const addChannelPhrase = async (req, res, channel) => {
	const phrase = str(req.body.phrase).trim();
	const duration = parseDuration(req.body.duration);
	if (!phrase) {
		return res.status(400).json({ error: 'phrase required' });
	}
	if (duration === 'invalid') {
		return res.status(400).json({ error: 'invalid duration (1–1209600s)' });
	}
	const reason = str(req.body.reason).trim();
	const reasonError = validateBanphraseReason(reason, phrase);
	if (reasonError) {
		return res.status(400).json({ error: reasonError });
	}
	await phrases.addPhrase({ channel: channel?.id ?? null }, { phrase, reason, duration, addedBy: req.sess?.username ?? null });
	return res.json(phraseRows(channel ? phrases.getChannelPhrases(channel.id) : phrases.getGlobal()));
};

const removeChannelPhrase = async (req, res, channel) => {
	const id = Number.parseInt(req.params.id ?? '', 10);
	const list = channel ? phrases.getChannelPhrases(channel.id) : phrases.getGlobal();
	const phrase = list.find((i) => i.ID === id);
	if (Number.isNaN(id)) {
		return res.status(400).json({ error: 'invalid id' });
	}
	if (!phrase) {
		return res.status(404).json({ error: 'not found' });
	}
	await phrases.removePhrase(phrase);
	return res.json(phraseRows(channel ? phrases.getChannelPhrases(channel.id) : phrases.getGlobal()));
};

// Gelernte Spam-Domains (services/spam-domains.js, alexmoderat 10.11.2026)
const spamDomainRows = async () =>
	(await spamDomains.list()).map((i) => ({
		domain: i._id,
		learnedBy: i.learnedBy,
		channel: i.sourceChannel,
		user: i.sourceUser,
		message: i.sourceMessage,
		created: i.created,
		hits: i.hits ?? 0,
		lastHit: i.lastHit,
	}));

/* ---------- titlenotify / tweetnotify ---------- */
// ninou2, 27.10./13.11.2026: Alarme gehoeren der Person, die sie angelegt hat, nicht dem Channel: "everything should be account
// related and not shared", "even if the command is created from another chat, it should only show [to] the person ... his
// own notifications on the website". Die Seite zeigt deshalb alle Alarme der angemeldeten Person (ueber alle Channels, in
// denen sie welche angelegt hat); die Meldung selbst erscheint in dem Channel, in dem der Alarm angelegt wurde.
const channelLabel = (channelId) => bot.Channels.get(channelId)?.name ?? String(channelId);

const ownRows = async (model, userAlias, fields) =>
	(await model.find({ userAlias }).lean())
		.map((i) => ({ ...fields(i), channel: channelLabel(i.channel), message: i.message ?? '', added: i.added }))
		.sort((a, b) => (a.streamer ?? a.account).localeCompare(b.streamer ?? b.account) || a.channel.localeCompare(b.channel));

const titleNotifyRows = async (userAlias) => await ownRows(bot.DB.TitleNotify, userAlias, (i) => ({ streamer: i.streamerLogin, times: cleanTimes(i.times) }));

const tweetNotifyRows = async (userAlias) => await ownRows(bot.DB.TweetNotify, userAlias, (i) => ({ account: i.account, times: cleanTimes(i.times) }));

// Nur die mitgeschickten Felder aendern: message und/oder times (Klick auf den Text oder die Anzahl in der Tabelle)
const bodyFields = (body) => ({
	...(body.message === undefined ? {} : { message: cleanMessage(body.message) }),
	...(body.times === undefined ? {} : { times: cleanTimes(body.times) }),
});

// Kanalname aus der URL -> Channel-ID (nur Channels, in denen der Bot ist)
const urlChannelId = (req) => findChannel(String(req.params.channel ?? '').toLowerCase())?.id ?? null;

/* ---------- raid notify ---------- */
// ninou2, 14.11.2026: "Raid notification on/off, off by default at the BOT commands, then ... a new title in the notification
// section named Raid Notify", danach eine Tabelle mit mehreren Benachrichtigungen (Schalter, Zeit, Text Standard/eigen, Anzahl).
// Sind alle aus oder entfernt, schaltet sich Raid Notify selbst aus (der Punkt verschwindet wieder).
const RAID_TEXT_MAX = 400;

const raidNotifyState = async (channel) => {
	const config = await raidNotifier.getConfig(channel);
	const subscribers = [];
	for (const row of await bot.DB.RaidSubscriber.find({ channel: channel.id }).lean()) {
		const user = await bot.Users.get(row.userAlias);
		if (user) {
			subscribers.push(user.name);
		}
	}
	return {
		enabled: config.enabled,
		items: config.items.map((i) => ({
			...i,
			custom: i.text !== null,
			text: i.text ?? raidNotifier.defaultText(i.seconds),
			uses: config.uses?.[String(i.seconds)] ?? 0,
		})),
		minSeconds: raidNotifier.MIN_LEAD_S,
		maxSeconds: raidNotifier.MAX_LEAD_S,
		maxItems: raidNotifier.MAX_ITEMS,
		subscribers: subscribers.sort((a, b) => a.localeCompare(b)),
	};
};

const raidRoute = (change) =>
	route(async (req, res) => {
		const channel = sessionChannel(req, res);
		if (!channel) {
			return;
		}
		const error = await change(channel, req);
		if (error) {
			res.status(400).json({ error });
			return;
		}
		res.json(await raidNotifyState(channel));
	});

// Der Bot-Besitzer sieht alle Eintraege, alle anderen nur den eigenen Channel (wie sb-v2)
const ownerView = async (req) => (req.sess?.channel === twitch().selfName ? await banwatchRows(null) : await banwatchRows(findChannel(req.sess?.channel ?? '')));

module.exports = {
	getCommand,
	commands,
	Router,
	Filter,
	phrases,
	spamDomains,
	customCommands,
	partChannel,
	resolveStreamer,
	watchStreamer,
	watchTitle,
	cleanHandle,
	cleanMessage,
	cleanTimes,
	accountExists,
	HANDLE,
	raidNotifier,
	utilityDb,
	getPrefix,
	fetchTwitchUser,
	applyLevel,
	effectiveLevel,
	parseLevel,
	setAutobanSwitch,
	BANPHRASE_REASONS,
	validateBanphraseReason,
	isAdminLogin,
	requireAdmin,
	requireSession,
	getConfig,
	loadOtherBotCommands,
	twitch,
	findChannel,
	str,
	parseDuration,
	phraseRows,
	issuer,
	channelBlock,
	ownLevel,
	commandBlock,
	setBlock,
	channelSettings,
	raidActiveCount,
	applyChannelSettings,
	usesByUser,
	executionCounts,
	usageCounts,
	UTILITY_TABLE,
	utilityNamesFor,
	ownName,
	addUtilityRows,
	lastUsedCounts,
	globalUsageCounts,
	utilityOnlyCommands,
	commandRows,
	commandOptions,
	notifyRows,
	addNotify,
	removeNotify,
	banwatchRows,
	addBanwatch,
	removeBanwatch,
	blacklist,
	admins,
	route,
	sessionChannel,
	paramChannel,
	addChannelPhrase,
	removeChannelPhrase,
	spamDomainRows,
	channelLabel,
	ownRows,
	titleNotifyRows,
	tweetNotifyRows,
	bodyFields,
	urlChannelId,
	RAID_TEXT_MAX,
	raidNotifyState,
	raidRoute,
	ownerView,
};
