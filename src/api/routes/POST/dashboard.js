const express = require('express');
const {
	getCommand,
	Filter,
	partChannel,
	resolveStreamer,
	watchTitle,
	cleanHandle,
	cleanMessage,
	cleanTimes,
	accountExists,
	HANDLE,
	raidNotifier,
	fetchTwitchUser,
	applyLevel,
	effectiveLevel,
	parseLevel,
	requireAdmin,
	requireSession,
	twitch,
	findChannel,
	str,
	issuer,
	ownLevel,
	commandBlock,
	setBlock,
	applyChannelSettings,
	notifyRows,
	addNotify,
	banwatchRows,
	addBanwatch,
	blacklist,
	admins,
	route,
	sessionChannel,
	paramChannel,
	addChannelPhrase,
	titleNotifyRows,
	tweetNotifyRows,
	raidRoute,
	ownerView,
} = require('../../dashboard.js');

const router = express.Router();

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

router.post(
	'/api/admin/global-banphrases',
	requireSession,
	requireAdmin,
	route(async (req, res) => {
		await addChannelPhrase(req, res, null);
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
		await setBlock(commandBlock(channel, command.Name), disabled, () => Filter.create({ Channel: channel.id, Command: command.Name, Type: 'Blacklist', Response: 'None', Issued_By: by }));
		res.json({ name: command.Name, disabled });
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
			{
				$set: { message: cleanMessage(req.body.message), times: cleanTimes(req.body.times) },
				$setOnInsert: { streamerLogin: streamer.login, added: new Date() },
			},
			{ upsert: true },
		);
		res.json(await titleNotifyRows(me));
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

router.post(
	'/api/raidnotify/items',
	requireSession,
	raidRoute(async (channel) => {
		let tooMany = false;
		await raidNotifier.updateItems(channel, (items) => {
			if (items.length >= raidNotifier.MAX_ITEMS) {
				tooMany = true;
				return items;
			}
			return [...items, raidNotifier.newItem(Math.max(0, ...items.map((i) => i.id)) + 1)];
		});
		return tooMany ? `At most ${raidNotifier.MAX_ITEMS} raid notifications.` : null;
	}),
);

router.post(
	'/api/raidnotify/test',
	requireSession,
	route(async (req, res) => {
		const channel = sessionChannel(req, res);
		if (!channel) {
			return;
		}
		const result = await raidNotifier.sendTest(channel, req.sess?.username ?? channel.name);
		if (result.error) {
			res.status(400).json({ error: result.error });
			return;
		}
		res.json(result);
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

module.exports = router;
