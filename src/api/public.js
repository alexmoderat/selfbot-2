const { Logger } = require('../misc/logger.js');
const { got } = require('../token/got.js');

const sbv2 = require('../database/sbv2.js');
const utilityDb = require('../database/utility.js');

const { commands, toListed } = require('../commandHandler.js');

const { execFile, execSync } = require('node:child_process');

const { existsSync, readFileSync, writeFileSync } = require('node:fs');

const { homedir } = require('node:os');

const path = require('node:path');

const { promisify } = require('node:util');

const { Router } = require('express');

const phrases = require('../util/moderation-phrases.js');

const { getRecentActions } = require('../util/moderation.js');

const { getRecent } = require('../util/event-feed.js');

const { recentChat } = require('../clients/modules/chat/chat-console-log.js');

const { fetchTwitchUser } = require('../util/twitch/twitch-utils.js');

const { fetchChannelRoleList, fetchUserRoleList } = require('../token/roles-tv.js');

const { getValidToken, helixAsUser } = require('../token/user-tokens.js');

const { buildEntries } = require('../util/command-catalog.js');

const { PUBLIC_RUN_COMMANDS, runPublicCommand } = require('./command-runner.js');

const { uploadToOwnHaste } = require('../token/haste.js');

const { formatSupibotOnly, loadSupibotCommands, supibotOnly } = require('../util/supibot-only.js');

/**
 * Oeffentliche Status-/Statistik-Endpunkte aus sb-v2s auth-server.ts fuer status.html, stats.html, stream-stats.html,
 * logs.html, roles.html und das botwatch-dashboard des autojoin-bots (/api/network-bot-stats, CORS offen).
 * Antwortformen (auch die deutschen Schluessel wie "selbst") unveraendert, damit die Seiten gleich bleiben.
 */
const execFileAsync = promisify(execFile);

const PROCESS_START = Date.now();

const ROOT = path.join(__dirname, '..', '..');

const AUTOJOIN_STATS_FILE = '/root/twitch-autojoin-bot/stats.json';

const NETWORK_STATS_TTL = 5 * 60_000;

const cache = { supibotOnly: null, network: null };

// Kategorien des Network-Bot-Radars (sb-v2: CATEGORY_LABELS)
const CATEGORY_LABELS = {
	fm: 'Repeated First Message Bot',
	vb: 'Repeated Viewbot Seller',
	dc: 'Repeated Discord Scammer',
	sm: 'Repeated Social Media Scammer',
};

// Ban-Gruende mit eindeutiger Scam-/Bot-Kategorie (sb-v2 ban-log-maria: SCAM_REASON_PATTERN)
const SCAM_REASON_PATTERN = /viewbot|sellerbot|follow-?bot|malware|scam|phishing|ban.?evader/i;

const one = (value) => (Array.isArray(value) ? String(value[0] ?? '') : value === undefined || value === null ? '' : String(value));

/** Zaehler aus den geteilten sb-v2-Tabellen (chat_data, MariaDB) */
const countShared = async (sql, params = []) => Number((await sbv2.query(sql, params))[0]?.c ?? 0);
const countUtility = async (sql, params = []) => Number((await utilityDb.query(sql, params))[0]?.c ?? 0);

const escapeLike = (value) => value.replaceAll(/[\\%_]/g, '\\$&');

const formatDbUptime = (total) => {
	const weeks = Math.floor(total / 604_800);
	const days = Math.floor((total % 604_800) / 86_400);
	const hours = Math.floor((total % 86_400) / 3600);
	const minutes = Math.floor((total % 3600) / 60);
	const secs = total % 60;
	if (weeks > 0) return `${weeks}w ${days}d ${hours}h ${minutes}m ${secs}s`;
	if (days > 0) return `${days}d ${hours}h ${minutes}m ${secs}s`;
	if (hours > 0) return `${hours}h ${minutes}m ${secs}s`;
	return `${minutes}m ${secs}s`;
};

/** Gesamtzahl der Bans laut Ban-Log, kurz gecacht (sb-v2: getTotalBans) */
let totalBans = { value: 0, at: 0 };

const getTotalBans = async () => {
	if (Date.now() - totalBans.at > 60_000) {
		totalBans = { value: await bot.DB.ModerationBanLog.estimatedDocumentCount().catch(() => totalBans.value), at: Date.now() };
	}
	return totalBans.value;
};

const getScammerStatus = async (username) => {
	const rows = (await bot.DB.ModerationBanLog.find({ username: username.toLowerCase() }, { channelName: 1, reason: 1 }).sort({ created: -1 }).lean()).map((i) => ({
		Channel_Name: i.channelName,
		Reason: i.reason ?? '',
	}));
	const scamRows = rows.filter((i) => SCAM_REASON_PATTERN.test(i.Reason));
	if (scamRows.length === 0) {
		return { monitored: false, reason: null, banCount: 0, channels: [] };
	}
	return { monitored: true, reason: scamRows[0].Reason, banCount: scamRows.length, channels: [...new Set(scamRows.map((i) => i.Channel_Name))] };
};

let networkRefreshing = false;

const computeNetworkStats = async () => {
	const categories = {};
	const bans = {};
	for (const [cat, label] of Object.entries(CATEGORY_LABELS)) {
		const rows = await utilityDb.query('SELECT COUNT(DISTINCT user_id) AS users, COUNT(*) AS sightings FROM first_message_sightings WHERE normalized_text LIKE ?', [`${cat}::%`]);
		categories[cat] = { distinctUsers: Number(rows[0]?.users ?? 0), sightings: Number(rows[0]?.sightings ?? 0) };

		// Wie LIKE '%label%' (MariaDB ohne Gross-/Kleinschreibung)
		const main = (await bot.DB.ModerationBanLog.distinct('username', { reason: new RegExp(bot.Utils.escapeRegExp(label), 'i') })).length;
		// Kletztenbrots Bot-Schema (gleicher Server, MariaDB), fehlt das Recht oder das Schema, zaehlt es 0
		const kletztenbrot = await countShared('SELECT COUNT(DISTINCT username) AS c FROM kletztenbrot_chat_data.ban_log WHERE reason LIKE ?', [`%${escapeLike(label)}%`]).catch(() => 0);
		bans[cat] = { main, kletztenbrot };
	}
	const monitoredUsers = await countUtility('SELECT COUNT(DISTINCT user_id) AS c FROM first_message_sightings');
	return { categories, bans, categoryLabels: CATEGORY_LABELS, monitoredUsers };
};

const refreshNetworkStats = () => {
	if (networkRefreshing) {
		return;
	}
	networkRefreshing = true;
	computeNetworkStats()
		.then((data) => {
			cache.network = { data, at: Date.now() };
		})
		.catch((e) => {
			cache.network ??= { data: { error: e instanceof Error ? e.message : String(e) }, at: Date.now() };
			Logger.warn('[web] network-bot-stats fehlgeschlagen', e);
		})
		.finally(() => {
			networkRefreshing = false;
		});
};

/** Chatlog eines Channels aus chatLines (userId = Twitch-ID, Name ueber die User-Collection), neueste zuerst */
const chatLogs = async (channelName, options) => {
	const channel = bot.Channels.get(channelName);
	if (!channel) {
		return [];
	}

	const filter = { channel: channel.id };
	if (options.search) {
		// wie LIKE '%text%' (MariaDB ohne Gross-/Kleinschreibung)
		filter.text = new RegExp(bot.Utils.escapeRegExp(options.search), 'i');
	}
	if (options.user) {
		const user = await bot.Users.get(options.user.toLowerCase());
		if (!user?.twitchId) {
			return [];
		}
		filter.userId = user.twitchId;
	}

	const lines = await bot.DB.ChatLine.find(filter)
		.sort({ posted: -1, _id: -1 })
		.skip(options.offset ?? 0)
		.limit(options.limit)
		.lean();
	const users = await bot.DB.User.find({ twitchId: { $in: [...new Set(lines.map((i) => i.userId))] } }, { name: 1, twitchId: 1 }).lean();
	const names = new Map(users.map((i) => [i.twitchId, i.name]));
	return lines.map((i) => ({ id: String(i._id), username: names.get(i.userId) ?? i.userId, user_id: i.userId, message: i.text, created_at: i.posted }));
};

const cors = (res) => res.header('Access-Control-Allow-Origin', '*');

const route = (handler) => (req, res) => {
	handler(req, res).catch((e) => {
		Logger.warn('[web] Fehler', req.path, e);
		res.status(500).json({ error: e instanceof Error ? e.message : String(e) });
	});
};

module.exports = {
	got,
	sbv2,
	utilityDb,
	commands,
	toListed,
	execFile,
	execSync,
	existsSync,
	readFileSync,
	writeFileSync,
	homedir,
	path,
	promisify,
	Router,
	phrases,
	getRecentActions,
	getRecent,
	recentChat,
	fetchTwitchUser,
	fetchChannelRoleList,
	fetchUserRoleList,
	getValidToken,
	helixAsUser,
	buildEntries,
	PUBLIC_RUN_COMMANDS,
	runPublicCommand,
	uploadToOwnHaste,
	formatSupibotOnly,
	loadSupibotCommands,
	supibotOnly,
	execFileAsync,
	PROCESS_START,
	ROOT,
	AUTOJOIN_STATS_FILE,
	NETWORK_STATS_TTL,
	cache,
	CATEGORY_LABELS,
	SCAM_REASON_PATTERN,
	one,
	countShared,
	countUtility,
	escapeLike,
	formatDbUptime,
	get totalBans() {
		return totalBans;
	},
	getTotalBans,
	getScammerStatus,
	get networkRefreshing() {
		return networkRefreshing;
	},
	computeNetworkStats,
	refreshNetworkStats,
	chatLogs,
	cors,
	route,
};
