const { getCommand, commands } = require('../clients/modules/commands.js');
const { Router } = require('express');

const Filter = require('../services/filter.js');
const phrases = require('../services/moderation-phrases.js');
const spamDomains = require('../services/spam-domains.js');
const customCommands = require('../services/custom-commands.js');
const { partChannel } = require('../services/channel-manager.js');
const { resolveStreamer, watchStreamer, watchTitle } = require('../services/notifications.js');
const { cleanHandle, cleanMessage, cleanTimes, accountExists, HANDLE } = require('../services/tweet-notify.js');
const raidNotifier = require('../modules/raid-notifier.js');
const sbv2 = require('../database/sbv2.js');
const { getPrefix } = require('../clients/modules/handler.js');
const { fetchTwitchUser } = require('../util/twitch/twitch-utils.js');
const { applyLevel, effectiveLevel, parseLevel } = require('../clients/modules/levels.js');
const { setAutobanSwitch } = require('../services/autoban-log.js');
const { BANPHRASE_REASONS, validateBanphraseReason } = require('../misc/ban-reason.js');
const { isAdminLogin, requireAdmin, requireSession } = require('./sessions.js');
const { getConfig } = require('../config.js');
const { loadOtherBotCommands } = require('../misc/command-listing.js');

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
	[...Filter.data.values()].find(
		(i) =>
			i.Type === 'Blacklist' && i.Channel === channel.id && i.Command === null && i.User_Alias === null && i.Invocation === null && i.Platform === null,
	);
const ownLevel = (command) => (command.Flags.includes('mod') ? 'mod' : 'everyone');
const commandBlock = (channel, command) =>
	[...Filter.data.values()].find(
		(i) => i.Type === 'Blacklist' && i.Channel === channel.id && i.Command === command && i.User_Alias === null && i.Invocation === null,
	);

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
	raidNotify: (await bot.Channels.getData(channel, 'raidNotify'))?.enabled === true,
});

const applyChannelSettings = async (req, channel) => {
	const { commandsAllowed, moderation, crossban, sevenTvAccess, badgeAlerts, badgeAlertsMessage, raidNotify } = req.body;
	if (typeof commandsAllowed === 'boolean') {
		const by = await issuer(req);
		await setBlock(channelBlock(channel), !commandsAllowed, () =>
			Filter.create({ Channel: channel.id, Type: 'Blacklist', Response: 'None', Issued_By: by }),
		);
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
		const current = (await bot.Channels.getData(channel, 'raidNotify')) ?? {};
		await bot.Channels.setData(channel, 'raidNotify', { ...current, enabled: raidNotify });
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
		sbv2.query(`SELECT command AS Command, COUNT(*) AS Uses FROM ${UTILITY_TABLE} WHERE channel = ? GROUP BY command`, [channel.name]),
	]);
	return addUtilityRows(new Map(rows.map((i) => [i.Command, Number(i.Uses)])), utility);
};

/**
 * Aufrufe des utility-bots (chat_data.utility_command_executions, seit 07.11.2026) zaehlen mit - ninou2, 07.11.2026:
 * "commands tab should include all COMMANDS that the [bot] execute, does not matter if its by [the utility-bot]
 * or if it come from the supibot code". Utility-Namen, die bei uns ein Alias sind, laufen unter unserem Namen.
 */
const UTILITY_TABLE = 'chat_data.utility_command_executions';
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

/** Aufrufe je Command ueber alle Channels (ninou2, 07.11.2026: "global" neben den eigenen Uses) */
const globalUsageCounts = async () => {
	const [own, utility] = await Promise.all([
		executionCounts({ command: { $not: /^custom:/ } }),
		sbv2.query(`SELECT command AS Command, COUNT(*) AS Uses FROM ${UTILITY_TABLE} GROUP BY command`),
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

const createDashboardRouter = () => {
	const router = Router();
	const route = (handler) => (req, res) => {
		handler(req, res).catch((e) => {
			console.warn('[web] Dashboard-Fehler', e);
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

	router.get(
		'/api/me',
		requireSession,
		route(async (req, res) => {
			// prefix: fuer die Usage im Command-Fenster ("!" bei ninou2, sonst "sb ")
			const channel = findChannel(req.sess?.channel ?? '') ?? null;
			const prefix = getPrefix(channel);
			res.json({
				username: req.sess?.username,
				channel: req.sess?.channel,
				bot: twitch().selfName,
				prefix,
				isAdmin: await isAdminLogin(req.sess?.channel ?? ''),
				joined: Boolean(channel && channel.mode !== 'Inactive'),
			});
		}),
	);

	/* ---------- admin ---------- */

	router.get(
		'/api/admin/channels',
		requireSession,
		requireAdmin,
		route(async (_req, res) => {
			res.json(
				[...bot.Channels.all()]
					.filter((i) => i.Platform === twitch())
					.map((i) => ({ channel: i.Name, display_name: i.Name }))
					.sort((a, b) => a.channel.localeCompare(b.channel)),
			);
		}),
	);

	router.get(
		'/api/admin/banphrases/:channel',
		requireSession,
		requireAdmin,
		route(async (req, res) => {
			const channel = paramChannel(req, res);
			if (channel) {
				res.json(phraseRows(phrases.getChannelPhrases(channel.id)));
			}
		}),
	);

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

	router.post(
		'/api/admin/banphrases/:channel',
		requireSession,
		requireAdmin,
		route(async (req, res) => {
			const channel = paramChannel(req, res);
			if (channel) {
				await addChannelPhrase(req, res, channel);
			}
		}),
	);
	router.delete(
		'/api/admin/banphrases/:channel/:id',
		requireSession,
		requireAdmin,
		route(async (req, res) => {
			const channel = paramChannel(req, res);
			if (channel) {
				await removeChannelPhrase(req, res, channel);
			}
		}),
	);

	router.get(
		'/api/admin/settings/channel/:channel',
		requireSession,
		requireAdmin,
		route(async (req, res) => {
			const channel = paramChannel(req, res);
			if (channel) {
				res.json(await channelSettings(channel));
			}
		}),
	);
	router.post(
		'/api/admin/settings/channel/:channel',
		requireSession,
		requireAdmin,
		route(async (req, res) => {
			const channel = paramChannel(req, res);
			if (channel) {
				res.json(await applyChannelSettings(req, channel));
			}
		}),
	);

	const commandRoutes = (prefix, pick, guards) => {
		const handlers = guards;
		router.get(
			prefix,
			...handlers,
			route(async (req, res) => {
				const channel = pick(req, res);
				if (channel) {
					res.json(await commandRows(channel));
				}
			}),
		);
		router.post(
			prefix,
			...handlers,
			route(async (req, res) => {
				const channel = pick(req, res);
				if (!channel) {
					return;
				}
				const name = str(req.body.name).toLowerCase().replace(/^!/, '');
				const response = str(req.body.response);
				if (!name || !response) {
					res.status(400).json({ error: 'name and response required' });
					return;
				}
				const existing = await customCommands.get(channel, `!${name}`);
				if (existing) {
					await customCommands.edit(existing, response, commandOptions(req.body));
				} else {
					await customCommands.add(channel, `!${name}`, response, commandOptions(req.body));
				}
				res.json(await commandRows(channel));
			}),
		);
		router.put(
			`${prefix}/:name`,
			...handlers,
			route(async (req, res) => {
				const channel = pick(req, res);
				if (!channel) {
					return;
				}
				const existing = await customCommands.get(channel, req.params.name ?? '');
				if (existing) {
					await customCommands.edit(existing, str(req.body.response) || existing.Response, commandOptions(req.body));
				}
				res.json(await commandRows(channel));
			}),
		);
		router.delete(
			`${prefix}/:name`,
			...handlers,
			route(async (req, res) => {
				const channel = pick(req, res);
				if (!channel) {
					return;
				}
				const existing = await customCommands.get(channel, req.params.name ?? '');
				if (existing) {
					await customCommands.remove(existing);
				}
				res.json(await commandRows(channel));
			}),
		);
	};

	commandRoutes('/api/admin/commands/:channel', paramChannel, [requireSession, requireAdmin]);
	commandRoutes('/api/commands', sessionChannel, [requireSession]);

	// Grund-Auswahl fuer die Banphrase-Formulare
	router.get(
		'/api/banphrase-reasons',
		requireSession,
		route(async (_req, res) => {
			res.json(BANPHRASE_REASONS);
		}),
	);

	router.get(
		'/api/admin/global-banphrases',
		requireSession,
		requireAdmin,
		route(async (_req, res) => {
			res.json(phraseRows(phrases.getGlobal()));
		}),
	);
	router.post(
		'/api/admin/global-banphrases',
		requireSession,
		requireAdmin,
		route(async (req, res) => {
			await addChannelPhrase(req, res, null);
		}),
	);
	router.delete(
		'/api/admin/global-banphrases/:id',
		requireSession,
		requireAdmin,
		route(async (req, res) => {
			await removeChannelPhrase(req, res, null);
		}),
	);

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
	router.get(
		'/api/admin/spam-domains',
		requireSession,
		requireAdmin,
		route(async (_req, res) => {
			res.json(await spamDomainRows());
		}),
	);
	router.delete(
		'/api/admin/spam-domains/:domain',
		requireSession,
		requireAdmin,
		route(async (req, res) => {
			await spamDomains.remove(req.params.domain ?? '');
			res.json(await spamDomainRows());
		}),
	);

	/* ---------- eigener Channel ---------- */

	router.get(
		'/api/banphrases',
		requireSession,
		route(async (req, res) => {
			const channel = sessionChannel(req, res);
			if (channel) {
				res.json(phraseRows(phrases.getChannelPhrases(channel.id)));
			}
		}),
	);
	router.post(
		'/api/banphrases',
		requireSession,
		route(async (req, res) => {
			const channel = sessionChannel(req, res);
			if (channel) {
				await addChannelPhrase(req, res, channel);
			}
		}),
	);
	router.delete(
		'/api/banphrases/:id',
		requireSession,
		route(async (req, res) => {
			const channel = sessionChannel(req, res);
			if (channel) {
				await removeChannelPhrase(req, res, channel);
			}
		}),
	);

	// ninou2, 07.11.2026: "N uses" anklicken -> welche User den Command im eigenen Channel wie oft benutzt haben
	router.get(
		'/api/command-users',
		requireSession,
		route(async (req, res) => {
			const channel = sessionChannel(req, res);
			if (!channel) {
				return;
			}
			const name = String(req.query.name ?? '')
				.replace(/^!/, '')
				.toLowerCase();
			if (!/^[a-z0-9_-]{1,50}$/.test(name)) {
				res.status(400).json({ error: 'Unknown command.' });
				return;
			}
			// ninou2, 07.11.2026: orangener "global"-Kasten -> nur Gesamtzahl ueber alle Channels und die eigene Zahl,
			// "does not tell other users names or channels, just the total global use [of] the command and the user global use"
			// ninou2, 07.11.2026 (Leaderboard): "when [clicking] the command it show a leaderboard with users use",
			// "like a global command use across all channels" - Rangliste der User ueber alle Channels, beide Bots
			if (req.query.global === '1' && req.query.list === '1') {
				const names = utilityNamesFor(name);
				const [own, utility] = await Promise.all([
					usesByUser({ command: name }),
					sbv2.query(`SELECT username AS Name, COUNT(*) AS Uses FROM ${UTILITY_TABLE} WHERE command IN (?) GROUP BY username`, [names]),
				]);
				const merged = new Map();
				for (const row of [...own, ...utility]) {
					const user = row.Name.toLowerCase();
					merged.set(user, (merged.get(user) ?? 0) + Number(row.Uses));
				}
				res.json(
					[...merged]
						.map(([user, uses]) => ({ user, uses }))
						.sort((x, y) => y.uses - x.uses || x.user.localeCompare(y.user))
						.slice(0, 200),
				);
				return;
			}

			if (req.query.global === '1') {
				const login = req.sess?.username?.toLowerCase() ?? '';
				const self = login ? await bot.Users.get(login) : null;
				const [total, mine, [utility]] = await Promise.all([
					bot.DB.CommandExecution.countDocuments({ command: name }),
					self ? bot.DB.CommandExecution.countDocuments({ command: name, userId: self.id }) : 0,
					sbv2.query(`SELECT COUNT(*) AS Total, COALESCE(SUM(username = ?), 0) AS Mine FROM ${UTILITY_TABLE} WHERE command IN (?)`, [
						login,
						utilityNamesFor(name),
					]),
				]);
				res.json({
					total: total + Number(utility?.Total ?? 0),
					mine: mine + Number(utility?.Mine ?? 0),
				});
				return;
			}

			const custom = req.query.custom === '1';
			const command = custom ? `custom:${channel.id}:${name}` : name;
			const [rows, utility] = await Promise.all([
				usesByUser({ channelId: channel.id, command }),
				custom
					? Promise.resolve([])
					: sbv2.query(`SELECT username AS Name, COUNT(*) AS Uses FROM ${UTILITY_TABLE} WHERE channel = ? AND command IN (?) GROUP BY username`, [
							channel.name,
							utilityNamesFor(name),
						]),
			]);
			const merged = new Map();
			for (const row of [...rows, ...utility]) {
				const user = row.Name.toLowerCase();
				merged.set(user, (merged.get(user) ?? 0) + Number(row.Uses));
			}
			res.json(
				[...merged]
					.map(([user, uses]) => ({ user, uses }))
					.sort((a, b) => b.uses - a.uses || a.user.localeCompare(b.user))
					.slice(0, 200),
			);
		}),
	);

	// ninou2, 07.11.2026: "a global leaderboard [of] the commands uses by all users" - nur Commands und Zahlen, keine Namen
	router.get(
		'/api/command-leaderboard',
		requireSession,
		route(async (_req, res) => {
			const globalUses = await globalUsageCounts();
			const prefix = bot.Config.prefix;
			const known = new Map();
			for (const command of commands.values()) {
				if (!command.Flags.includes('owner')) {
					known.set(command.Name, command.Flags.includes('no-prefix') ? '!' : `${prefix} `);
				}
			}
			for (const command of utilityOnlyCommands()) {
				known.set(command.Name, '!');
			}
			// ninou2, 07.11.2026: "directly next to the command name add alias (the one most used by the users)", z.B. "botwebsite (!bw)"
			const [ownInv, utilityInv] = await Promise.all([
				bot.DB.CommandExecution.aggregate([
					{ $match: { command: { $not: /^custom:/ }, invocation: { $ne: null } } },
					{ $group: { _id: { command: '$command', invocation: { $toLower: '$invocation' } }, Uses: { $sum: 1 } } },
				]).then((rows) => rows.map((i) => ({ Command: i._id.command, Invocation: i._id.invocation, Uses: i.Uses }))),
				sbv2.query(
					`SELECT command AS Command, invocation AS Invocation, COUNT(*) AS Uses FROM ${UTILITY_TABLE} WHERE invocation IS NOT NULL GROUP BY command, invocation`,
				),
			]);
			const invocations = new Map();
			for (const row of [...ownInv, ...utilityInv.map((i) => ({ ...i, Command: ownName(i.Command) }))]) {
				const perCommand = invocations.get(row.Command) ?? new Map();
				perCommand.set(row.Invocation, (perCommand.get(row.Invocation) ?? 0) + Number(row.Uses));
				invocations.set(row.Command, perCommand);
			}
			const topAlias = (name) => {
				const top = [...(invocations.get(name) ?? [])].sort((x, y) => y[1] - x[1] || x[0].localeCompare(y[0]))[0];
				return top && top[0] !== name ? top[0] : null;
			};

			res.json(
				[...globalUses]
					.filter(([name, uses]) => known.has(name) && uses > 0)
					.map(([name, uses]) => ({ name, prefix: known.get(name), alias: topAlias(name), uses }))
					.sort((a, b) => b.uses - a.uses || a.name.localeCompare(b.name)),
			);
		}),
	);

	router.get(
		'/api/settings/commands',
		requireSession,
		route(async (req, res) => {
			const channel = sessionChannel(req, res);
			if (!channel) {
				return;
			}
			const [uses, globalUses] = await Promise.all([usageCounts(channel), globalUsageCounts()]);
			const levels = (await bot.Channels.getData(channel, 'commandLevels')) ?? {};
			res.json(
				[...commands.values()]
					.filter((i) => !i.Flags.includes('owner'))
					.map((i) => ({
						name: i.Name,
						uses: uses.get(i.Name) ?? 0,
						globalUses: globalUses.get(i.Name) ?? 0,
						aliases: i.Aliases,
						description: i.Description,
						usage: i.Usage,
						noPrefix: i.Flags.includes('no-prefix'),
						permission: i.permission,
						// ninou2, 29.10.2026: Rechte-Stufe je Command, wie "perm <command> everyone|mods|streamer"
						level: effectiveLevel(ownLevel(i), levels[i.Name]),
						disabled: Boolean(commandBlock(channel, i.Name)?.Active),
						external: false,
					}))
					// Commands, die nur der utility-bot kann: mit Zahlen, aber ohne Level/An-Aus (die steuert der selfbot nicht)
					.concat(
						utilityOnlyCommands().map((i) => ({
							name: i.Name,
							uses: uses.get(i.Name) ?? 0,
							globalUses: globalUses.get(i.Name) ?? 0,
							aliases: i.Aliases,
							description: i.Description,
							usage: i.Usage,
							noPrefix: true,
							permission: i.permission === 'mod' ? 'mod' : 'everyone',
							level: i.permission === 'mod' ? 'mod' : 'everyone',
							disabled: false,
							external: true,
						})),
					)
					.sort((a, b) => a.name.localeCompare(b.name)),
			);
		}),
	);
	router.post(
		'/api/settings/commands',
		requireSession,
		route(async (req, res) => {
			const channel = sessionChannel(req, res);
			if (!channel) {
				return;
			}
			const command = getCommand(str(req.body.command).toLowerCase());
			if (!command) {
				res.status(404).json({ error: 'unknown command' });
				return;
			}
			if (command.Flags.includes('owner')) {
				res.status(403).json({ error: 'not self-service' });
				return;
			}
			if (req.body.level !== undefined) {
				const level = parseLevel(str(req.body.level));
				const updated = level ? applyLevel((await bot.Channels.getData(channel, 'commandLevels')) ?? {}, command.Name, ownLevel(command), level) : null;
				if (!updated) {
					res.status(400).json({ error: 'invalid level' });
					return;
				}
				await bot.Channels.setData(channel, 'commandLevels', updated);
				res.json({ name: command.Name, level: effectiveLevel(ownLevel(command), updated[command.Name]) });
				return;
			}
			const disabled = Boolean(req.body.disabled);
			const by = await issuer(req);
			await setBlock(commandBlock(channel, command.Name), disabled, () =>
				Filter.create({ Channel: channel.id, Command: command.Name, Type: 'Blacklist', Response: 'None', Issued_By: by }),
			);
			res.json({ name: command.Name, disabled });
		}),
	);

	router.get(
		'/api/settings/channel',
		requireSession,
		route(async (req, res) => {
			const channel = sessionChannel(req, res);
			if (channel) {
				res.json(await channelSettings(channel));
			}
		}),
	);
	router.post(
		'/api/settings/channel',
		requireSession,
		route(async (req, res) => {
			const channel = sessionChannel(req, res);
			if (channel) {
				res.json(await applyChannelSettings(req, channel));
			}
		}),
	);

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

	router.get(
		'/api/titlenotify',
		requireSession,
		route(async (req, res) => {
			res.json(await titleNotifyRows(await issuer(req)));
		}),
	);
	router.post(
		'/api/titlenotify',
		requireSession,
		route(async (req, res) => {
			const channel = sessionChannel(req, res);
			if (!channel) {
				return;
			}
			const login = str(req.body.streamer)
				.toLowerCase()
				.replace(/^[@#]+/, '')
				.trim();
			const streamer = login ? await resolveStreamer(login) : null;
			if (!streamer) {
				res.status(404).json({ error: 'streamer not found' });
				return;
			}
			if (await bot.DB.TitleNotifyOptout.exists({ streamerId: streamer.id })) {
				res.status(409).json({ error: `${streamer.login} opted out of title alerts` });
				return;
			}
			watchTitle(streamer.id);
			const me = await issuer(req);
			await bot.DB.TitleNotify.updateOne(
				{ channel: channel.id, streamerId: streamer.id, userAlias: me },
				{ $set: { message: cleanMessage(req.body.message), times: cleanTimes(req.body.times) }, $setOnInsert: { streamerLogin: streamer.login, added: new Date() } },
				{ upsert: true },
			);
			res.json(await titleNotifyRows(me));
		}),
	);
	router.put(
		'/api/titlenotify/:streamer/:channel',
		requireSession,
		route(async (req, res) => {
			const me = await issuer(req);
			const channelId = urlChannelId(req);
			if (channelId !== null) {
				await bot.DB.TitleNotify.updateOne(
					{ channel: channelId, userAlias: me, streamerLogin: String(req.params.streamer ?? '').toLowerCase() },
					{ $set: bodyFields(req.body) },
				);
			}
			res.json(await titleNotifyRows(me));
		}),
	);
	router.delete(
		'/api/titlenotify/:streamer/:channel',
		requireSession,
		route(async (req, res) => {
			const me = await issuer(req);
			const channelId = urlChannelId(req);
			if (channelId !== null) {
				await bot.DB.TitleNotify.deleteMany({
					channel: channelId,
					userAlias: me,
					streamerLogin: String(req.params.streamer ?? '').toLowerCase(),
				});
			}
			res.json(await titleNotifyRows(me));
		}),
	);

	router.get(
		'/api/tweetnotify',
		requireSession,
		route(async (req, res) => {
			res.json(await tweetNotifyRows(await issuer(req)));
		}),
	);
	router.post(
		'/api/tweetnotify',
		requireSession,
		route(async (req, res) => {
			const channel = sessionChannel(req, res);
			if (!channel) {
				return;
			}
			const account = cleanHandle(str(req.body.account));
			if (!HANDLE.test(account) || !(await accountExists(account))) {
				res.status(404).json({ error: 'account not found or has no public tweets' });
				return;
			}
			const me = await issuer(req);
			await bot.DB.TweetNotify.updateOne(
				{ channel: channel.id, account, userAlias: me },
				{ $set: { message: cleanMessage(req.body.message), times: cleanTimes(req.body.times) }, $setOnInsert: { added: new Date() } },
				{ upsert: true },
			);
			res.json(await tweetNotifyRows(me));
		}),
	);
	// Zusatztext eines bestehenden Alarms aendern (ninou2, 13.11.2026: "content area of the message ... should be clickable")
	router.put(
		'/api/tweetnotify/:account/:channel',
		requireSession,
		route(async (req, res) => {
			const me = await issuer(req);
			const channelId = urlChannelId(req);
			if (channelId !== null) {
				await bot.DB.TweetNotify.updateOne(
					{ channel: channelId, userAlias: me, account: cleanHandle(req.params.account) },
					{ $set: bodyFields(req.body) },
				);
			}
			res.json(await tweetNotifyRows(me));
		}),
	);
	router.delete(
		'/api/tweetnotify/:account/:channel',
		requireSession,
		route(async (req, res) => {
			const me = await issuer(req);
			const channelId = urlChannelId(req);
			if (channelId !== null) {
				await bot.DB.TweetNotify.deleteMany({ channel: channelId, userAlias: me, account: cleanHandle(req.params.account) });
			}
			res.json(await tweetNotifyRows(me));
		}),
	);

	/* ---------- raid notify ---------- */
	// ninou2, 14.11.2026: "Raid notification on/off, off by default at the BOT commands, then ... a new title in the notification
	// section named Raid Notify". Texte und Anzahl liegen wie bisher in den Vorlagen !raidping / !raidreminder, der Zeitpunkt der
	// Erinnerung (5-120 s vor Start) in den Channel-Daten.
	const RAID_TEXT_MAX = 400;
	const raidNotifyState = async (channel) => {
		const uses = await usageCounts(channel);
		const settings = (await bot.Channels.getData(channel, 'raidNotify')) ?? {};
		const template = async (name, fallback) => {
			const row = await customCommands.get(channel, `!${name}`).catch(() => null);
			return {
				text: row?.Response ?? fallback,
				times: row?.Times ? cleanTimes(row.Times) : 1,
				uses: uses.get(`custom:${channel.id}:${name}`) ?? 0,
			};
		};
		const subscribers = [];
		for (const row of await bot.DB.RaidSubscriber.find({ channel: channel.id }).lean()) {
			const user = await bot.Users.get(row.userAlias);
			if (user) {
				subscribers.push(user.name);
			}
		}
		return {
			enabled: settings.enabled === true,
			seconds: raidNotifier.clampLead(settings.seconds),
			minSeconds: raidNotifier.MIN_LEAD_S,
			maxSeconds: raidNotifier.MAX_LEAD_S,
			ping: await template('raidping', raidNotifier.DEFAULT_RAID_MESSAGE),
			reminder: await template('raidreminder', raidNotifier.DEFAULT_RAID_REMINDER),
			subscribers: subscribers.sort((a, b) => a.localeCompare(b)),
		};
	};
	const saveRaidTemplate = async (channel, name, fallback, input) => {
		if (!input || typeof input !== 'object') {
			return;
		}
		const existing = await customCommands.get(channel, `!${name}`).catch(() => null);
		const text = str(input.text).replaceAll(/[\r\n]+/g, ' ').trim().slice(0, RAID_TEXT_MAX) || existing?.Response || fallback;
		const options = {
			Cooldown: existing?.Cooldown ?? 5,
			Mod_Only: Boolean(existing?.Mod_Only),
			Reply: Boolean(existing?.Reply),
			Times: input.times === undefined ? (existing?.Times ?? 1) : cleanTimes(input.times),
		};
		if (existing) {
			await customCommands.edit(existing, text, options);
		} else {
			await customCommands.add(channel, `!${name}`, text, options);
		}
	};

	router.get(
		'/api/raidnotify',
		requireSession,
		route(async (req, res) => {
			const channel = sessionChannel(req, res);
			if (channel) {
				res.json(await raidNotifyState(channel));
			}
		}),
	);
	router.put(
		'/api/raidnotify',
		requireSession,
		route(async (req, res) => {
			const channel = sessionChannel(req, res);
			if (!channel) {
				return;
			}
			await saveRaidTemplate(channel, 'raidping', raidNotifier.DEFAULT_RAID_MESSAGE, req.body.ping);
			await saveRaidTemplate(channel, 'raidreminder', raidNotifier.DEFAULT_RAID_REMINDER, req.body.reminder);
			if (req.body.seconds !== undefined) {
				const current = (await bot.Channels.getData(channel, 'raidNotify')) ?? {};
				await bot.Channels.setData(channel, 'raidNotify', { ...current, seconds: raidNotifier.clampLead(req.body.seconds) });
			}
			res.json(await raidNotifyState(channel));
		}),
	);

	/* ---------- notify / banwatch ---------- */

	router.get(
		'/api/notify',
		requireSession,
		route(async (req, res) => {
			const channel = sessionChannel(req, res);
			if (channel) {
				res.json(await notifyRows(channel));
			}
		}),
	);
	router.post(
		'/api/notify',
		requireSession,
		route(async (req, res) => {
			const channel = sessionChannel(req, res);
			if (!channel) {
				return;
			}
			const streamer = str(req.body.streamer).trim();
			if (!streamer) {
				res.status(400).json({ error: 'streamer required' });
				return;
			}
			if (!(await addNotify(channel, streamer, req.body.message === undefined ? undefined : str(req.body.message).trim(), req.body.times))) {
				res.status(404).json({ error: 'streamer not found' });
				return;
			}
			res.json(await notifyRows(channel));
		}),
	);
	router.delete(
		'/api/notify/:streamer',
		requireSession,
		route(async (req, res) => {
			const channel = sessionChannel(req, res);
			if (channel) {
				await removeNotify(channel, req.params.streamer ?? '');
				res.json(await notifyRows(channel));
			}
		}),
	);

	router.get(
		'/api/admin/notify/:channel',
		requireSession,
		requireAdmin,
		route(async (req, res) => {
			const channel = paramChannel(req, res);
			if (channel) {
				res.json(await notifyRows(channel));
			}
		}),
	);
	router.post(
		'/api/admin/notify/:channel',
		requireSession,
		requireAdmin,
		route(async (req, res) => {
			const channel = paramChannel(req, res);
			if (!channel) {
				return;
			}
			const streamer = str(req.body.streamer).trim();
			if (!streamer) {
				res.status(400).json({ error: 'streamer required' });
				return;
			}
			if (!(await addNotify(channel, streamer, str(req.body.message).trim()))) {
				res.status(404).json({ error: 'streamer not found' });
				return;
			}
			res.json(await notifyRows(channel));
		}),
	);
	router.delete(
		'/api/admin/notify/:channel/:streamer',
		requireSession,
		requireAdmin,
		route(async (req, res) => {
			const channel = paramChannel(req, res);
			if (channel) {
				await removeNotify(channel, req.params.streamer ?? '');
				res.json(await notifyRows(channel));
			}
		}),
	);

	// Der Bot-Besitzer sieht alle Eintraege, alle anderen nur den eigenen Channel (wie sb-v2)
	const ownerView = async (req) =>
		req.sess?.channel === twitch().selfName ? await banwatchRows(null) : await banwatchRows(findChannel(req.sess?.channel ?? ''));
	router.get(
		'/api/banwatch',
		requireSession,
		route(async (req, res) => {
			res.json(await ownerView(req));
		}),
	);
	router.post(
		'/api/banwatch',
		requireSession,
		route(async (req, res) => {
			const login = str(req.body.login).trim();
			if (!login) {
				res.status(400).json({ error: 'login required' });
				return;
			}
			const isOwner = req.sess?.channel === twitch().selfName;
			const channel = findChannel(isOwner && str(req.body.channel) ? str(req.body.channel) : (req.sess?.channel ?? ''));
			if (!channel) {
				res.status(404).json({ error: 'channel not joined' });
				return;
			}
			await addBanwatch(channel, login, str(req.body.message).trim());
			res.json(await ownerView(req));
		}),
	);
	router.delete(
		'/api/banwatch/:channel/:login',
		requireSession,
		route(async (req, res) => {
			const isOwner = req.sess?.channel === twitch().selfName;
			const channel = findChannel(isOwner ? (req.params.channel ?? '') : (req.sess?.channel ?? ''));
			if (channel) {
				await removeBanwatch(channel, req.params.login ?? '');
			}
			res.json(await ownerView(req));
		}),
	);
	router.delete(
		'/api/banwatch/:login',
		requireSession,
		route(async (req, res) => {
			const channel = findChannel(req.sess?.channel ?? '');
			if (channel) {
				await removeBanwatch(channel, req.params.login ?? '');
			}
			res.json(await banwatchRows(channel ?? null));
		}),
	);

	router.get(
		'/api/admin/banwatch/:channel',
		requireSession,
		requireAdmin,
		route(async (req, res) => {
			const channel = paramChannel(req, res);
			if (channel) {
				res.json(await banwatchRows(channel));
			}
		}),
	);
	router.post(
		'/api/admin/banwatch/:channel',
		requireSession,
		requireAdmin,
		route(async (req, res) => {
			const channel = paramChannel(req, res);
			if (!channel) {
				return;
			}
			const login = str(req.body.login).trim();
			if (!login) {
				res.status(400).json({ error: 'login required' });
				return;
			}
			await addBanwatch(channel, login, str(req.body.message).trim());
			res.json(await banwatchRows(channel));
		}),
	);
	router.delete(
		'/api/admin/banwatch/:channel/:login',
		requireSession,
		requireAdmin,
		route(async (req, res) => {
			const channel = paramChannel(req, res);
			if (channel) {
				await removeBanwatch(channel, req.params.login ?? '');
				res.json(await banwatchRows(channel));
			}
		}),
	);

	/* ---------- Blacklist / Admins ---------- */

	router.get(
		'/api/admin/blacklist',
		requireSession,
		requireAdmin,
		route(async (_req, res) => {
			res.json(await blacklist());
		}),
	);
	router.post(
		'/api/admin/blacklist',
		requireSession,
		requireAdmin,
		route(async (req, res) => {
			const login = str(req.body.channel).toLowerCase().replace(/^#/, '').trim();
			if (!login) {
				res.status(400).json({ error: 'channel required' });
				return;
			}
			let channel = findChannel(login);
			if (!channel) {
				const user = await fetchTwitchUser(login);
				if (!user) {
					res.status(404).json({ error: 'channel not found' });
					return;
				}
				channel = await bot.Channels.add(user.login, twitch(), 'Inactive', user.id);
				await bot.Channels.setData(channel, 'inactive', { reason: 'manual', since: new Date().toISOString(), previousMode: 'Write' });
			} else if (channel.mode !== 'Inactive') {
				await partChannel(channel);
			} else {
				await bot.Channels.setData(channel, 'inactive', { reason: 'manual', since: new Date().toISOString(), previousMode: 'Write' });
			}
			res.json(await blacklist());
		}),
	);
	router.delete(
		'/api/admin/blacklist/:channel',
		requireSession,
		requireAdmin,
		route(async (req, res) => {
			// Wie sb-v2: nur die Sperre aufheben, Auto-Join holt den Channel dann wieder, wenn der Bot dort Mod ist
			const channel = findChannel(req.params.channel ?? '');
			if (channel && (await bot.Channels.getData(channel, 'inactive'))?.reason === 'manual') {
				await bot.Channels.setData(channel, 'inactive', null);
			}
			res.json(await blacklist());
		}),
	);

	router.get(
		'/api/admin/admins',
		requireSession,
		requireAdmin,
		route(async (_req, res) => {
			res.json(await admins());
		}),
	);
	router.post(
		'/api/admin/admins',
		requireSession,
		requireAdmin,
		route(async (req, res) => {
			const username = str(req.body.username).toLowerCase().trim();
			if (!username) {
				res.status(400).json({ error: 'username required' });
				return;
			}
			const user = await bot.Users.getOrCreate(username);
			await bot.Users.setData(user, 'administrator', true);
			res.json(await admins());
		}),
	);
	router.delete(
		'/api/admin/admins/:username',
		requireSession,
		requireAdmin,
		route(async (req, res) => {
			const user = await bot.Users.get(String(req.params.username).toLowerCase());
			if (user) {
				await bot.Users.setData(user, 'administrator', null);
			}
			res.json(await admins());
		}),
	);

	router.get(
		'/api/stats',
		requireSession,
		route(async (req, res) => {
			const channel = sessionChannel(req, res);
			if (!channel) {
				return;
			}
			res.json({
				banphrases: phrases.getChannelPhrases(channel.id).length,
				commands: (await customCommands.list(channel)).length,
				notify: (await notifyRows(channel)).length,
				// ninou2, 28.10.2026: Zahl am Title-Notify-Tab stand bis zum Anklicken auf 0
				titlenotify: (await titleNotifyRows(await issuer(req))).length,
				tweetnotify: (await tweetNotifyRows(await issuer(req))).length,
				banwatch: (await banwatchRows(channel)).length,
				raidNotify: (await bot.Channels.getData(channel, 'raidNotify'))?.enabled === true,
			});
		}),
	);

	return router;
};

module.exports = { createDashboardRouter };
