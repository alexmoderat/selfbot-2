const { got } = require('../token/got.js');
const { escapeRegExp } = require('../misc/utility.js');
const { getConfig } = require('../config.js');
const { isAutomatedBanReason } = require('./ban-reason.js');
const { fetchTwitchUser } = require('./twitch/twitch-utils.js');

// Moderations-Kern aus sb-v2: banUser() (src/services/twitch-api.ts) mit dem Pro-Channel-Schalter
// "autoban all" (v2/singletons/autoban-gate.ts), recordModAction() (src/services/mod-actions.js),
// announceBan() (v2/utils/ban-announce.ts) und der Auto-Ban-Zaehler (v2/singletons/ban-counter.ts).
// Neue automatische Ban-Pfade MUESSEN ueber banUser() gehen, sonst greift der Schalter nicht.

const { modLogChannel } = getConfig().values;

const MAX_RECENT_ACTIONS = 15;
const DEDUP_WINDOW = 5000; // Bot-eigene Bans kommen kurz danach nochmal ueber Hermes rein
const ANNOUNCE_COOLDOWN = 30_000;
const DEFAULT_BOTBANS_TEMPLATE = '@{username} Auto-Bans in #{channel}: {count} · Global: {global}.';

const recentActions = [];
const recentlyRecorded = new Map();
const announceCooldowns = new Map();

const getTwitch = () => bot.Twitch;
const selfName = () => getTwitch().selfName;

/* ---------- Schalter ---------- */

const channelFlag = async (channelName, property) => {
	const channel = bot.Channels.get(channelName);
	if (!channel) {
		return null;
	}

	return await bot.Channels.getData(channel, property);
};

/** "autoban all disable": automatische Bans/Timeouts in diesem Channel unterdruecken */
const isAutobanDisabled = async (channelName) => (await channelFlag(channelName, 'autobanDisabled')) === true;

/* ---------- Bannen ---------- */

const postBan = async (target, options) =>
	await got('Helix')({
		method: 'POST',
		url: 'moderation/bans',
		searchParams: { broadcaster_id: target.broadcasterId, moderator_id: getTwitch().selfId },
		json: {
			data: {
				user_id: target.userId,
				reason: options.reason || 'AutoMod',
				...(options.duration ? { duration: options.duration } : {}),
			},
		},
	});

/** Low-Trust-Status setzen (Helix suspicious_users): restricted, active_monitoring oder no_treatment (aufheben) */
const restrictUser = async (target, treatment) => {
	const response = await got('Helix')({
		method: 'PUT',
		url: 'moderation/suspicious_users',
		json: {
			broadcaster_id: target.broadcasterId,
			moderator_id: getTwitch().selfId,
			user_id: target.userId,
			treatment,
		},
	});

	return response;
};

/** Eingeschraenkte (restricted) User laesst Twitch nicht bannen (422) - erst die Einschraenkung aufheben */
const unrestrict = async (target) => (await restrictUser(target, 'no_treatment')).ok;

/** Ban oder Timeout aufheben (Helix DELETE moderation/bans) */
const unbanUser = async (target) =>
	await got('Helix')({
		method: 'DELETE',
		url: 'moderation/bans',
		searchParams: { broadcaster_id: target.broadcasterId, moderator_id: getTwitch().selfId, user_id: target.userId },
	});

/**
 * Bannt oder timeoutet ueber Helix. Liefert true bei Erfolg.
 * Automatische Gruende (isAutomatedBanReason) werden in Channels mit "autoban all disable" verworfen.
 */
const banUser = async (target, options) => {
	if (isAutomatedBanReason(options.reason) && (await isAutobanDisabled(target.channelName))) {
		console.warn(`[moderation] Auto-Ban unterdrueckt (autoban all: disabled in #${target.channelName}): ${target.userName} - ${options.reason}`);
		return false;
	}

	let response = await postBan(target, options);
	if (response.statusCode === 422) {
		console.warn(`[moderation] ${target.userName} ist in #${target.channelName} eingeschraenkt - aufheben und erneut versuchen`);
		if (await unrestrict(target)) {
			response = await postBan(target, options);
		}
	}

	if (!response.ok) {
		console.warn(`[moderation] Ban fehlgeschlagen [${response.statusCode}]: ${target.userName} in #${target.channelName}`, response.body);
		return false;
	}

	if (!options.skipLog) {
		recordModAction({
			type: options.duration ? 'timeout' : 'ban',
			username: target.userName,
			userId: target.userId,
			channelName: target.channelName,
			channel: target.channel ?? null,
			reason: options.reason,
			status: options.status ?? 'REGULAR',
			duration: options.duration ?? null,
			modName: selfName(),
			automated: Boolean(options.automated),
		});
	}

	return true;
};

/**
 * Automatischer Ban eines Moduls samt Ansage: banUser() + announceBan() (+ Auto-Ban-Zaehler-Ansage, wenn automated) -
 * das, was in sb-v2 jedes Modul einzeln nach banUser() aufrief.
 */
const autoBan = async (target, options) => {
	const ok = await banUser(target, options);
	if (ok) {
		await announceBan(target.channelName, target.userName, options.publicReason, options.duration ?? null);
		if (options.automated && target.channel) {
			await announceAutobanCount(target.channel);
		}
	}

	return ok;
};

/** Ban-Ziel aus Channel-Objekt + Chat-User bauen */
const targetFromChannel = (channel, userId, userName) => ({
	channel,
	channelName: channel.name,
	broadcasterId: channel.twitchId ?? '',
	userId,
	userName,
});

/** Ban-Ziel fuer beliebige Channels per Login (crossban, massban) */
const resolveTarget = async (channelName, userId, userName) => {
	const known = bot.Channels.get(channelName);
	if (known?.twitchId) {
		return targetFromChannel(known, userId, userName);
	}

	const broadcaster = await fetchTwitchUser(channelName);
	return broadcaster ? { channel: null, channelName: broadcaster.login, broadcasterId: broadcaster.id, userId, userName } : null;
};

/* ---------- Protokoll ---------- */

const dedupKey = (username, channel) => `${username.toLowerCase()}@${channel.toLowerCase()}`;
const stripHtml = (input) => input.replace(/<[^>]*>/g, '');

const recordModAction = (data) => {
	const key = dedupKey(data.username, data.channelName);
	recentlyRecorded.set(key, Date.now());
	setTimeout(() => recentlyRecorded.delete(key), DEDUP_WINDOW).unref();

	recentActions.unshift({
		type: data.type,
		username: stripHtml(data.username),
		channel: stripHtml(data.channelName),
		reason: stripHtml(data.reason),
		status: data.status,
		modName: data.modName,
		ts: Date.now(),
	});
	if (recentActions.length > MAX_RECENT_ACTIONS) {
		recentActions.pop();
	}

	void (async () => {
		await bot.DB.createWithId('ModerationBanLog', {
			username: data.username.toLowerCase(),
			userId: data.userId ?? null,
			channelName: data.channelName.replace(/^#/, '').toLowerCase(),
			channel: data.channel?.id ?? null,
			type: data.type,
			duration: data.duration ?? null,
			reason: data.reason,
			status: data.status,
			modName: data.modName,
			automated: Boolean(data.automated),
			created: new Date(),
		});
	})().catch((e) => console.warn('[moderation] Ban-Log fehlgeschlagen', e));
};

/** Wurde die Aktion gerade vom Bot selbst protokolliert? (dann nicht nochmal aus Hermes) */
const wasRecentlyRecorded = (username, channel) => recentlyRecorded.has(dedupKey(username, channel));

const getRecentActions = () => recentActions;

/* ---------- Auto-Ban-Zaehler (sb-v2: ban-counter.ts) ---------- */

const getAutobanCounts = async (channelName) => {
	const count = async (channel) =>
		await bot.DB.ModerationBanLog.countDocuments({
			automated: true,
			modName: exactInsensitive(selfName()),
			...(channel ? { channelName: exactInsensitive(channel) } : {}),
		});

	// Channel: Zaehlerstand aus sb-v2 (Block 10) - dessen autoban_count liess sich aus dem Ban-Log nicht nachrechnen.
	// Global: alle Bot-Bans im Ban-Log (ninou2, 28.10.2026: "global not 4k" - der alte Global-Zaehler stand bei ~940,
	// das Log kennt ueber 4000), dieselbe Zahl wie bei !whenbotbans global.
	const channelData = channelName ? bot.Channels.get(channelName) : null;
	const [channelCount, globalCount, channelBase] = await Promise.all([
		channelName ? count(channelName) : Promise.resolve(0),
		getBotBanLogCount(null),
		channelData ? bot.Channels.getData(channelData, 'autobanCountBase') : Promise.resolve(null),
	]);

	return {
		channel: Number(channelCount ?? 0) + Number(channelBase ?? 0),
		global: globalCount,
	};
};

/**
 * Bot-Bans mit Datum fuer !whenbotbans (ninou2, 28.10.2026: "!botbans 5", "!botbans global 366"): eigene automatische
 * seit dem Umstieg und die aus sb-v2 uebernommenen, erkennbar am Grund ("... (Automated by alexmoderat)",
 * "Automated ban by alexmoderat - ..."). Eigene Nummerierung - der !botbans-Zaehler (sb-v2-Stand + neue Bans) bleibt,
 * ninou2: "thats why i sugegsted new command name ... we are talking about the original global info command"
 */
/** Gleich wie in MariaDB (Kollation ohne Gross-/Kleinschreibung) */
const exactInsensitive = (value) => new RegExp(`^${escapeRegExp(value)}$`, 'i');

const botBanFilter = (channelName) => {
	const name = escapeRegExp(selfName().toLowerCase());
	return {
		$or: [
			{ automated: true, modName: exactInsensitive(selfName()) },
			{ reason: new RegExp(`automated by ${name}`, 'i') },
			{ reason: new RegExp(`^automated ban by ${name}`, 'i') },
		],
		...(channelName ? { channelName: exactInsensitive(channelName) } : {}),
	};
};

const getBotBanLogCount = async (channelName) => await bot.DB.ModerationBanLog.countDocuments(botBanFilter(channelName));

/** Der N-te Bot-Bann (1 = erster), im Channel oder ueber alle Channels */
const getNthBotBan = async (n, channelName) => {
	const row = await bot.DB.ModerationBanLog.findOne(botBanFilter(channelName), { created: 1, channelName: 1 })
		.sort({ created: 1, _id: 1 })
		.skip(Math.max(0, Math.trunc(n) - 1))
		.lean();
	return row ? { created: new Date(row.created), channel: row.channelName } : null;
};

const ordinal = (n) => {
	const tens = n % 100;
	const suffix = tens >= 11 && tens <= 13 ? 'th' : ({ 1: 'st', 2: 'nd', 3: 'rd' }[n % 10] ?? 'th');
	return `${n}${suffix}`;
};

/**
 * ninou2, 28.10.2026: "the 366th bans happened on : DATE , in @username channel" bzw. "the 366th Global ban happened
 * on : DATE , in @username channel"
 */
const formatNthBotBan = (n, created, channel, global) => {
	const date = `${created.toISOString().slice(0, 10)} ${created.toISOString().slice(11, 19)} UTC`;
	return `the ${ordinal(n)}${global ? ' Global' : ''} ban happened on : ${date} , in @${channel} channel`;
};

/** "<Nummer>" oder "global <Nummer>" -> Antwort mit Datum; null, wenn keine Nummer angegeben ist */
const answerNthBotBan = async (args, channelName, display) => {
	const isGlobal = args[0]?.toLowerCase() === 'global';
	const rawNumber = isGlobal ? args[1] : args[0];
	if (rawNumber === undefined || !/^\d+$/.test(rawNumber)) {
		return null;
	}

	const n = Number(rawNumber);
	const ban = n >= 1 ? await getNthBotBan(n, isGlobal ? null : channelName) : null;
	if (!ban) {
		const total = await getBotBanLogCount(isGlobal ? null : channelName);
		return `@${display}, there are only ${total} dated bans ${isGlobal ? 'globally' : `in #${channelName}`} so far.`;
	}

	return formatNthBotBan(n, ban.created, ban.channel, isGlobal);
};

const formatBotbansText = (template, data) =>
	(template || DEFAULT_BOTBANS_TEMPLATE)
		.replace('{username}', data.username)
		.replace('{channel}', data.channel)
		.replace('{count}', String(data.count))
		.replace('{global}', String(data.global));

/** Nach jedem automatischen Ban: Ansage im Channel, wenn dort "banannounce on" gesetzt ist (hoechstens alle 30 s) */
const announceAutobanCount = async (channel) => {
	if ((await bot.Channels.getData(channel, 'autobanAnnounce')) !== true) {
		return;
	}

	const now = Date.now();
	if (now - (announceCooldowns.get(channel.name) ?? 0) < ANNOUNCE_COOLDOWN) {
		return;
	}
	announceCooldowns.set(channel.name, now);

	const counts = await getAutobanCounts(channel.name);
	const template = await bot.Channels.getData(channel, 'botbansText');
	await bot.Channels.send(
		channel,
		formatBotbansText(template, {
			username: selfName(),
			channel: channel.name,
			count: counts.channel,
			global: counts.global,
		}),
	);
};

/* ---------- Ansagen ---------- */

let modLogBroadcasterId = null;

/**
 * Ansage automatischer Bans gesammelt im Modlog-Channel (alexmoderat, 15.09.2026: "das wenn mein Bot
 * jemanden autobant das der Bot das in nem Twitch chat schreibt" - "Alexmoderat_modlogs moechte er").
 */
const announceBan = async (channelName, userName, reason, duration) => {
	const text = duration
		? `⏱️ @${userName} was timed out for ${duration}s in #${channelName} — ${reason}`
		: `🔨 @${userName} was banned in #${channelName} — ${reason}`;

	// Nicht nach Discord: dorthin kommt der Ban ueber discord-mirror (Hermes meldet auch die eigenen Bans)
	await sayModLog(text);
};

/** Ist ein Modlog-Channel eingestellt? (Module ueberspringen Nachrichten aus dem Modlog-Channel selbst) */
const getModLogChannel = () => modLogChannel;

/**
 * Text in den Modlog-Channel (sb-v2: platform.say(MOD_LOG_CHANNEL, ...)) - Ban-Ansagen, Probelauf-Meldungen der
 * Raid-Erkennung, CatQuery- und Watch-Hinweise. Ohne modLogChannel (Testphase) nur ins Log.
 */
const sayModLog = async (text) => {
	if (!modLogChannel) {
		console.log(`[modlog] ${text}`);
		return;
	}

	try {
		modLogBroadcasterId ??= (await fetchTwitchUser(modLogChannel))?.id ?? null;
		if (modLogBroadcasterId) {
			await getTwitch().sendToBroadcaster(text, modLogBroadcasterId);
		}
	} catch (e) {
		console.warn(`[moderation] Nachricht in #${modLogChannel} fehlgeschlagen`, e);
	}
};

/* ---------- Discord ---------- */

/**
 * Betriebs-Warnungen (disk-watch, smartbox-watch) - sb-v2 nutzte dafuer den Haupt-Webhook. Eigener Webhook
 * DISCORD_ALERT_WEBHOOK, sonst der Modlog-Webhook; ohne beide nur ins Log.
 */
const sendAlert = async (content) => {
	const url = process.env.DISCORD_ALERT_WEBHOOK || process.env.DISCORD_MODLOG_WEBHOOK;
	if (!url) {
		console.warn(`[alert] ${content}`);
		return;
	}

	await got('Global')({
		method: 'POST',
		url,
		json: { content: content.slice(0, 1990) },
		responseType: 'text',
		timeout: { request: 5000 },
	}).catch(() => null);
};

let discordRateLimited = 0;
let lastDiscordWarning = 0;

/**
 * Discord-Webhook fuer das Mod-Log (DISCORD_MODLOG_WEBHOOK). Absichtlich nicht abgewartet und ohne Warteschlange,
 * wie sb-v2s discord-mirror: eine spaete Meldung ist weniger wert als eine fehlende. 429 wird gezaehlt und geloggt.
 */
const sendToDiscord = async (content) => {
	const url = process.env.DISCORD_MODLOG_WEBHOOK;
	if (!url) {
		return;
	}

	const response = await got('Global')({
		method: 'POST',
		url,
		json: { content: content.slice(0, 1990) },
		responseType: 'text',
		timeout: { request: 5000 },
	}).catch(() => null);

	if (response?.statusCode === 429) {
		discordRateLimited++;
		if (Date.now() - lastDiscordWarning > 60_000) {
			console.warn(`[discord] Ratelimit: ${discordRateLimited} Nachricht(en) abgewiesen`);
			lastDiscordWarning = Date.now();
			discordRateLimited = 0;
		}
	}
};

module.exports = {
	isAutobanDisabled,
	restrictUser,
	unbanUser,
	banUser,
	autoBan,
	targetFromChannel,
	resolveTarget,
	recordModAction,
	wasRecentlyRecorded,
	getRecentActions,
	getAutobanCounts,
	getBotBanLogCount,
	getNthBotBan,
	ordinal,
	formatNthBotBan,
	answerNthBotBan,
	formatBotbansText,
	announceAutobanCount,
	announceBan,
	getModLogChannel,
	sayModLog,
	sendAlert,
	sendToDiscord,
};
