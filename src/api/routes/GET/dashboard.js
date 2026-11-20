const express = require('express');
const {
	commands,
	phrases,
	customCommands,
	raidNotifier,
	utilityDb,
	getPrefix,
	effectiveLevel,
	BANPHRASE_REASONS,
	isAdminLogin,
	requireAdmin,
	requireSession,
	twitch,
	findChannel,
	str,
	phraseRows,
	issuer,
	ownLevel,
	commandBlock,
	channelSettings,
	raidActiveCount,
	usesByUser,
	usageCounts,
	UTILITY_TABLE,
	utilityNamesFor,
	ownName,
	lastUsedCounts,
	globalUsageCounts,
	utilityOnlyCommands,
	commandRows,
	commandOptions,
	notifyRows,
	banwatchRows,
	blacklist,
	admins,
	route,
	sessionChannel,
	paramChannel,
	spamDomainRows,
	titleNotifyRows,
	tweetNotifyRows,
	raidRoute,
	ownerView,
} = require('../../dashboard.js');

const router = express.Router();

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
				// Umbenennen (ninou2, 14.11.2026: "clicking edit should let u edit the command name too"): nur freie, gueltige Namen
				let newName = null;
				if (req.body.newName !== undefined && req.body.newName !== null) {
					newName = `!${str(req.body.newName).toLowerCase().replace(/^!+/, '')}`;
					if (!/^![a-z0-9_-]{1,30}$/.test(newName)) {
						res.status(400).json({ error: 'invalid name' });
						return;
					}
					if (newName !== existing.Name.toLowerCase() && (await customCommands.get(channel, newName))) {
						res.status(409).json({ error: `!${newName.slice(1)} already exists` });
						return;
					}
				}
				await customCommands.edit(existing, str(req.body.response) || existing.Response, commandOptions(req.body), newName);
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

router.get(
	'/api/admin/spam-domains',
	requireSession,
	requireAdmin,
	route(async (_req, res) => {
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
				utilityDb.query(`SELECT username AS "Name", COUNT(*) AS "Uses" FROM ${UTILITY_TABLE} WHERE command = ANY(?) GROUP BY username`, [names]),
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
				utilityDb.query(`SELECT COUNT(*) AS "Total", COUNT(*) FILTER (WHERE username = ?) AS "Mine" FROM ${UTILITY_TABLE} WHERE command = ANY(?)`, [login, utilityNamesFor(name)]),
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
				: utilityDb.query(`SELECT username AS "Name", COUNT(*) AS "Uses" FROM ${UTILITY_TABLE} WHERE channel = ? AND command = ANY(?) GROUP BY username`, [
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
			utilityDb.query(`SELECT command AS "Command", invocation AS "Invocation", COUNT(*) AS "Uses" FROM ${UTILITY_TABLE} WHERE invocation IS NOT NULL GROUP BY command, invocation`),
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
		const [uses, globalUses, lastUsed] = await Promise.all([usageCounts(channel), globalUsageCounts(), lastUsedCounts(channel).catch(() => new Map())]);
		const levels = (await bot.Channels.getData(channel, 'commandLevels')) ?? {};
		res.json(
			[...commands.values()]
				.filter((i) => !i.Flags.includes('owner'))
				.map((i) => ({
					name: i.Name,
					uses: uses.get(i.Name) ?? 0,
					lastUsed: lastUsed.get(i.Name) ?? null,
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
						lastUsed: lastUsed.get(i.Name) ?? null,
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

router.get(
	'/api/titlenotify',
	requireSession,
	route(async (req, res) => {
		res.json(await titleNotifyRows(await issuer(req)));
	}),
);

router.get(
	'/api/tweetnotify',
	requireSession,
	route(async (req, res) => {
		res.json(await tweetNotifyRows(await issuer(req)));
	}),
);

router.get(
	'/api/raidnotify',
	requireSession,
	raidRoute(async () => null),
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

router.get(
	'/api/banwatch',
	requireSession,
	route(async (req, res) => {
		res.json(await ownerView(req));
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

/* ---------- Blacklist / Admins ---------- */

router.get(
	'/api/admin/blacklist',
	requireSession,
	requireAdmin,
	route(async (_req, res) => {
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
			raidNotify: (await raidNotifier.getConfig(channel)).enabled,
			raidNotifyActive: await raidActiveCount(channel),
		});
	}),
);

module.exports = router;
