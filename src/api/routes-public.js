const { got } = require('../token/got.js');
const sbv2 = require('../database/sbv2.js');
const { commands, toListed } = require('../clients/modules/commands.js');
const { execFile, execSync } = require('node:child_process');
const { existsSync, readFileSync, writeFileSync } = require('node:fs');
const { homedir } = require('node:os');
const path = require('node:path');
const { promisify } = require('node:util');
const { Router } = require('express');

const phrases = require('../services/moderation-phrases.js');
const { getRecentActions } = require('../services/moderation.js');
const { getRecent } = require('../services/event-feed.js');
const { recentChat } = require('../modules/chat-console-log.js');
const { fetchTwitchUser } = require('../util/twitch/twitch-utils.js');
const { fetchChannelRoleList, fetchUserRoleList } = require('../misc/roles-tv.js');
const { getValidToken, helixAsUser } = require('../misc/user-tokens.js');
const { buildEntries } = require('../commands/botcommands.js');
const { PUBLIC_RUN_COMMANDS, runPublicCommand } = require('./command-runner.js');
const { uploadToOwnHaste } = require('../misc/haste.js');
const { formatSupibotOnly, loadSupibotCommands, supibotOnly } = require('../misc/supibot-only.js');

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
let supibotOnlyCache = null;

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
	const rows = (await bot.DB.ModerationBanLog.find({ username: username.toLowerCase() }, { channelName: 1, reason: 1 }).sort({ created: -1 }).lean()).map(
		(i) => ({
			Channel_Name: i.channelName,
			Reason: i.reason ?? '',
		}),
	);
	const scamRows = rows.filter((i) => SCAM_REASON_PATTERN.test(i.Reason));
	if (scamRows.length === 0) {
		return { monitored: false, reason: null, banCount: 0, channels: [] };
	}
	return { monitored: true, reason: scamRows[0].Reason, banCount: scamRows.length, channels: [...new Set(scamRows.map((i) => i.Channel_Name))] };
};

let networkCache = null;
let networkRefreshing = false;
const computeNetworkStats = async () => {
	const categories = {};
	const bans = {};
	for (const [cat, label] of Object.entries(CATEGORY_LABELS)) {
		const rows = await sbv2.query(
			'SELECT COUNT(DISTINCT user_id) AS users, COUNT(*) AS sightings FROM chat_data.first_message_sightings WHERE normalized_text LIKE ?',
			[`${cat}::%`],
		);
		categories[cat] = { distinctUsers: Number(rows[0]?.users ?? 0), sightings: Number(rows[0]?.sightings ?? 0) };

		// Wie LIKE '%label%' (MariaDB ohne Gross-/Kleinschreibung)
		const main = (await bot.DB.ModerationBanLog.distinct('username', { reason: new RegExp(bot.Utils.escapeRegExp(label), 'i') })).length;
		// Kletztenbrots Bot-Schema (gleicher Server, MariaDB), fehlt das Recht oder das Schema, zaehlt es 0
		const kletztenbrot = await countShared('SELECT COUNT(DISTINCT username) AS c FROM kletztenbrot_chat_data.ban_log WHERE reason LIKE ?', [
			`%${escapeLike(label)}%`,
		]).catch(() => 0);
		bans[cat] = { main, kletztenbrot };
	}
	const monitoredUsers = await countShared('SELECT COUNT(DISTINCT user_id) AS c FROM chat_data.first_message_sightings');
	return { categories, bans, categoryLabels: CATEGORY_LABELS, monitoredUsers };
};

const refreshNetworkStats = () => {
	if (networkRefreshing) {
		return;
	}
	networkRefreshing = true;
	computeNetworkStats()
		.then((data) => {
			networkCache = { data, at: Date.now() };
		})
		.catch((e) => {
			networkCache ??= { data: { error: e instanceof Error ? e.message : String(e) }, at: Date.now() };
			console.warn('[web] network-bot-stats fehlgeschlagen', e);
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

const createPublicRouter = () => {
	const router = Router();
	const cors = (res) => res.header('Access-Control-Allow-Origin', '*');
	const route = (handler) => (req, res) => {
		handler(req, res).catch((e) => {
			console.warn('[web] Fehler', req.path, e);
			res.status(500).json({ error: e instanceof Error ? e.message : String(e) });
		});
	};

	router.get(
		'/api/status',
		route(async (_req, res) => {
			cors(res);
			const pm2 = async () => {
				try {
					const { stdout } = await execFileAsync('pm2', ['jlist'], { timeout: 5000, maxBuffer: 4 * 1024 * 1024 });
					return JSON.parse(stdout).map((i) => ({
						name: i.name,
						status: i.pm2_env?.status,
						uptimeMs: i.pm2_env?.status === 'online' ? Date.now() - (i.pm2_env.pm_uptime ?? Date.now()) : null,
						restarts: i.pm2_env?.restart_time ?? 0,
						memoryMiB: i.monit?.memory ? Number((i.monit.memory / 1024 / 1024).toFixed(1)) : null,
						cpu: i.monit?.cpu ?? null,
					}));
				} catch (e) {
					console.warn('[web] pm2 jlist fehlgeschlagen', e);
					return null;
				}
			};
			const dbLatency = async () => {
				const start = Date.now();
				try {
					await bot.DB.mongoose.connection.db.admin().ping();
					return Date.now() - start;
				} catch {
					return null;
				}
			};
			const justlogChannels = async () => {
				const response = await got('Global')({ url: 'http://127.0.0.1:8025/channels', timeout: { request: 3000 } }).catch(() => null);
				return response?.ok ? (response.body.channels?.length ?? null) : null;
			};
			const commit = () => {
				try {
					return execSync('git rev-parse --short HEAD', { cwd: ROOT }).toString().trim();
				} catch {
					return 'unknown';
				}
			};
			// Ausgewaehlte Log-Zeilen dieses Prozesses (sb-v2: channel-notify, degraded, Ban-Ansagen, Startfehler, Cron-Fehler)
			const recentEvents = () => {
				// pm2 setzt "name" (selfbot bzw. im Parallelbetrieb selfbot-next)
				const file = path.join(homedir(), '.pm2', 'logs', `${process.env.name ?? 'selfbot'}-out.log`);
				if (!existsSync(file)) {
					return [];
				}
				const pattern = /\[channel-manager\]|\[suspension\]|\[degraded\]|has received a Twitch ban|Startfehler|Cron.*(Fehler|fehlgeschlagen)/;
				return readFileSync(file, 'utf8')
					.split('\n')
					.filter((i) => pattern.test(i))
					.slice(-30)
					.reverse();
			};

			const twitch = bot.Twitch;
			const [processes, dbMs, justlog] = await Promise.all([pm2(), dbLatency(), justlogChannels()]);
			res.json({
				timestamp: Date.now(),
				selbst: {
					uptimeMs: Date.now() - PROCESS_START,
					channels: bot.Channels.getJoinable().length,
					memoryMiB: Number((process.memoryUsage().rss / 1024 / 1024).toFixed(1)),
					commit: commit(),
					node: process.version,
				},
				pm2: processes,
				dbLatenzMs: dbMs,
				justlogChannels: justlog,
				justlogSyncedAt: null,
				chatFeed: recentChat(),
				letzteEreignisse: recentEvents(),
			});
		}),
	);

	router.get(
		'/api/stats/global',
		route(async (_req, res) => {
			const twitch = bot.Twitch;
			const channels = bot.Channels.getJoinable();
			const tokens = new Set(await bot.DB.UserToken.distinct('login'));
			let blacklisted = 0;
			for (const channel of bot.Channels.all()) {
				if (channel.mode === 'Inactive' && (await bot.Channels.getData(channel, 'inactive'))?.reason === 'manual') {
					blacklisted++;
				}
			}
			// Laufzeit der Datenbank (bisher MariaDB "Uptime", jetzt MongoDB serverStatus)
			const uptime = (
				await bot.DB.mongoose.connection.db
					.admin()
					.serverStatus()
					.catch(() => null)
			)?.uptime;

			res.json({
				channels: channels.length,
				botChannels: channels.filter((i) => tokens.has(i.Name)).length,
				banPhrases: phrases.getGlobal().length + [...bot.Channels.all()].reduce((sum, i) => sum + phrases.getChannelPhrases(i.ID).length, 0),
				blacklist: blacklisted,
				banWatch: await bot.DB.NotifyBan.countDocuments(),
				streamersWatched: (await bot.DB.NotifyLive.distinct('streamerId')).length,
				customCommands: await bot.DB.CustomCommand.countDocuments(),
				notifications: await bot.DB.NotifyLive.countDocuments(),
				trackedUsers: (await bot.DB.Watchtime.distinct('userId').catch(() => [])).length,
				streakDaysTotal: await bot.DB.StreamStreakDay.estimatedDocumentCount().catch(() => 0),
				dbUptime: uptime ? formatDbUptime(Math.trunc(Number(uptime))) : 'unknown',
				timestamp: Date.now(),
			});
		}),
	);

	router.get(
		'/api/mod-actions',
		route(async (_req, res) => {
			cors(res);
			res.json({ actions: getRecentActions(), totalBans: await getTotalBans() });
		}),
	);

	router.get('/api/events/raw', (_req, res) => {
		cors(res);
		res.json({ events: getRecent(200) });
	});

	router.get('/api/network-bot-stats', (_req, res) => {
		cors(res);
		let live = null;
		try {
			live = JSON.parse(readFileSync(AUTOJOIN_STATS_FILE, 'utf8'));
		} catch {
			/* autojoin-bot noch nicht bereit */
		}
		if (!networkCache || Date.now() - networkCache.at >= NETWORK_STATS_TTL) {
			refreshNetworkStats();
		}
		res.json({ live, db: networkCache?.data ?? null, dbAgeMs: networkCache ? Date.now() - networkCache.at : null, timestamp: Date.now() });
	});

	router.get('/api/commands/list', (_req, res) => {
		res.json(
			[...commands.values()].map((i) => ({
				name: i.Name,
				aliases: i.Aliases,
				usage: i.Usage ?? null,
				description: i.Description ?? null,
				permission: i.permission,
				noPrefix: i.Flags.includes('no-prefix'),
			})),
		);
	});

	// Oeffentliche Command-Seite /commands (alexmoderat, 01.11.2026): dieselbe Liste wie botcommands, ohne Owner-Commands
	// Dashboard-Link "Commands only working with Supibot": Liste frisch berechnen, als Tabelle auf den eigenen Haste-Server,
	// gleicher Inhalt = gleicher Link (keine neue Paste pro Klick)
	router.get(
		'/api/commands/supibot-only',
		route(async (_req, res) => {
			const own = [...commands.values()].map((i) => i.toListed());
			const text = formatSupibotOnly(supibotOnly(loadSupibotCommands(), own));
			if (!text) {
				res.status(503).type('text/plain').send("The Supibot command list isn't available right now.");
				return;
			}

			if (supibotOnlyCache?.text !== text) {
				supibotOnlyCache = { text, url: await uploadToOwnHaste(text, { hash: 'cmds' }) };
			}

			res.redirect(302, supibotOnlyCache.url);
		}),
	);

	router.get('/api/commands/public', (_req, res) => {
		res.json(
			buildEntries()
				.filter((i) => i.command.permission !== 'owner')
				.map(({ command, prefix }) => ({
					name: command.Name,
					prefix,
					aliases: command.Aliases,
					description: command.Description,
					usage: command.Usage,
					permission: command.permission,
					runnable: PUBLIC_RUN_COMMANDS.has(command.Name),
				})),
		);
	});

	router.post(
		'/api/commands/run',
		route(async (req, res) => {
			const body = req.body ?? {};
			const result = await runPublicCommand({ channel: body.channel, input: body.input, ip: req.ip ?? 'unknown' });
			if ('retryAfter' in result && result.retryAfter) {
				res.setHeader('Retry-After', String(result.retryAfter));
			}

			return res.status(result.status).json('replies' in result ? { replies: result.replies } : { error: result.error });
		}),
	);

	router.get(
		'/api/scammer',
		route(async (req, res) => {
			const name = one(req.query.name).trim().toLowerCase();
			if (!name) {
				return res.status(400).json({ error: 'name parameter is required' });
			}
			return res.json(await getScammerStatus(name));
		}),
	);

	// Wie /api/scammer, zusaetzlich das Network-Bot-Radar: gleiche Erstnachricht in >= 2 Channels = verdaechtig
	router.get(
		'/api/monitored',
		route(async (req, res) => {
			const name = one(req.query.name).trim().toLowerCase();
			if (!name) {
				return res.status(400).json({ error: 'name parameter is required' });
			}
			const banStatus = await getScammerStatus(name);
			if (banStatus.monitored) {
				return res.json(banStatus);
			}

			const user = await fetchTwitchUser(name).catch(() => null);
			const empty = { monitored: false, reason: null, banCount: 0, channels: [] };
			if (!user) {
				return res.json(empty);
			}
			const texts = (
				await sbv2.query('SELECT DISTINCT normalized_text AS t FROM chat_data.first_message_sightings WHERE user_id = ? LIMIT 200', [user.id])
			).map((i) => i.t);

			let bestReason = null;
			let bestChannels = [];
			for (const text of texts) {
				const channels = (
					await sbv2.query('SELECT DISTINCT channel AS c FROM chat_data.first_message_sightings WHERE normalized_text = ?', [text])
				).map((i) => i.c);
				if (channels.length >= 2 && channels.length > bestChannels.length) {
					bestChannels = channels;
					bestReason = CATEGORY_LABELS[text.split('::')[0]] ?? 'Suspicious repeated message';
				}
			}
			return res.json(bestReason ? { monitored: true, reason: `${bestReason} (not yet banned)`, banCount: 0, channels: bestChannels } : empty);
		}),
	);

	// Rollen live von roles.tv - ohne eigene Sammlung (alexmoderat: "rollen brauchen wir gar nicht speichern")
	router.get(
		'/api/roles/user/:username',
		route(async (req, res) => {
			const login = String(req.params.username).toLowerCase();
			const [mods, vips] = await Promise.all([fetchUserRoleList(login, 'moderators'), fetchUserRoleList(login, 'vips')]);
			const map = (list) => (list?.entries ?? []).map((i) => ({ channel: i.login, first_seen: i.grantedAt, last_seen: null }));
			const roles = { mod: map(mods), vip: map(vips) };
			res.json({ user: login, roles, total: roles.mod.length + roles.vip.length, is_bot: false });
		}),
	);
	router.get(
		'/api/roles/channel/:channel',
		route(async (req, res) => {
			const channel = String(req.params.channel).toLowerCase();
			const [mods, vips] = await Promise.all([fetchChannelRoleList(channel, 'moderators'), fetchChannelRoleList(channel, 'vips')]);
			const map = (list) => (list?.entries ?? []).map((i) => ({ user: i.login, user_id: null, first_seen: i.grantedAt, last_seen: null, is_bot: false }));
			const roles = { mod: map(mods), vip: map(vips) };
			res.json({ channel, roles, total: roles.mod.length + roles.vip.length, last_crawled: new Date().toISOString() });
		}),
	);
	// Gesamtzahlen gab es nur aus sb-v2s gecrawlter Rollen-Tabelle - ohne Sammlung null
	router.get('/api/roles/stats', (_req, res) => {
		res.json({ channels_total: null, channels_crawled: null, entries_total: null, mods_total: null, vips_total: null, bots_total: null });
	});

	router.get(
		'/api/update-stream-key',
		route(async (_req, res) => {
			const streamer = bot.Twitch.selfName;
			const file = process.env.WEB_STREAM_SH;
			const token = await getValidToken(streamer);
			const user = await fetchTwitchUser(streamer);
			if (!token || !user) {
				return res.status(400).json({ error: `No token for ${streamer}. Re-authenticate first.` });
			}
			if (!file || !existsSync(file)) {
				return res.status(400).json({ error: 'WEB_STREAM_SH not configured' });
			}
			const response = await helixAsUser(token, { url: 'streams/key', searchParams: { broadcaster_id: user.id } });
			const streamKey = response.ok ? response.body.data?.[0]?.stream_key : undefined;
			if (!streamKey) {
				return res.status(400).json({ error: 'Could not fetch stream key. Missing channel:read:stream_key scope?' });
			}
			writeFileSync(file, readFileSync(file, 'utf8').replace(/^STREAM_KEY=".+"/m, `STREAM_KEY="${streamKey}"`));
			return res.json({ ok: true, stream_key: `${streamKey.slice(0, 20)}...` });
		}),
	);

	router.get(
		'/api/logs/:channel',
		route(async (req, res) => {
			const channel = String(req.params.channel).toLowerCase();
			const limit = Math.min(Number.parseInt(one(req.query.limit), 10) || 100, 1000);
			const offset = Number.parseInt(one(req.query.offset), 10) || 0;
			const search = one(req.query.search).trim() || null;
			const logs = (await chatLogs(channel, { limit, offset, search })).reverse();
			res.json({ channel, logs, limit, offset, count: logs.length });
		}),
	);
	router.get(
		'/api/logs/:channel/user/:username',
		route(async (req, res) => {
			const channel = String(req.params.channel).toLowerCase();
			const username = String(req.params.username).toLowerCase();
			const limit = Math.min(Number.parseInt(one(req.query.limit), 10) || 100, 1000);
			const logs = (await chatLogs(channel, { limit, user: username })).reverse();
			res.json({ channel, username, logs, count: logs.length });
		}),
	);

	return router;
};

module.exports = { CATEGORY_LABELS, SCAM_REASON_PATTERN, formatDbUptime, getScammerStatus, createPublicRouter, chatLogs };
