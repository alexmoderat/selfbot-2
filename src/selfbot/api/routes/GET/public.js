const express = require('express');
const {
	got,
	utilityDb,
	commands,
	execSync,
	existsSync,
	readFileSync,
	writeFileSync,
	homedir,
	path,
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
	one,
	formatDbUptime,
	getTotalBans,
	getScammerStatus,
	refreshNetworkStats,
	chatLogs,
	cors,
	route,
} = require('../../public.js');

const router = express.Router();

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
				await bot.SQL.query('SELECT 1');
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
		// Laufzeit der Datenbank (bisher MariaDB "Uptime", jetzt Postgres seit dem Start des Servers)
		const uptime = (
			await bot.SQL.query('SELECT EXTRACT(EPOCH FROM now() - pg_postmaster_start_time()) AS uptime')
				.then((result) => result.rows[0])
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
	if (!cache.network || Date.now() - cache.network.at >= NETWORK_STATS_TTL) {
		refreshNetworkStats();
	}
	res.json({ live, db: cache.network?.data ?? null, dbAgeMs: cache.network ? Date.now() - cache.network.at : null, timestamp: Date.now() });
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

// Oeffentliche Command-Seite /commands (alexmoderat, 01.11.2026): Liste aus misc/command-catalog.js, ohne Owner-Commands
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

		if (cache.supibotOnly?.text !== text) {
			cache.supibotOnly = { text, url: await uploadToOwnHaste(text, { hash: 'cmds' }) };
		}

		res.redirect(302, cache.supibotOnly.url);
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
		const texts = (await utilityDb.query('SELECT DISTINCT normalized_text AS t FROM first_message_sightings WHERE user_id = ? LIMIT 200', [user.id])).map((i) => i.t);

		let bestReason = null;
		let bestChannels = [];
		for (const text of texts) {
			const channels = (await utilityDb.query('SELECT DISTINCT channel AS c FROM first_message_sightings WHERE normalized_text = ?', [text])).map((i) => i.c);
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

module.exports = router;
