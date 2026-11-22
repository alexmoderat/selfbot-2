const express = require('express');
const {
	spamDomains,
	cleanHandle,
	raidNotifier,
	requireAdmin,
	requireSession,
	twitch,
	findChannel,
	issuer,
	notifyRows,
	removeNotify,
	banwatchRows,
	removeBanwatch,
	blacklist,
	admins,
	route,
	sessionChannel,
	paramChannel,
	removeChannelPhrase,
	spamDomainRows,
	titleNotifyRows,
	tweetNotifyRows,
	urlChannelId,
	raidRoute,
	ownerView,
} = require('../../dashboard.js');

const router = express.Router();

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

router.delete(
	'/api/admin/global-banphrases/:id',
	requireSession,
	requireAdmin,
	route(async (req, res) => {
		await removeChannelPhrase(req, res, null);
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

router.delete(
	'/api/raidnotify/items/:id',
	requireSession,
	raidRoute(async (channel, req) => {
		const id = Number(req.params.id);
		await raidNotifier.updateItems(channel, (items) => items.filter((i) => i.id !== id));
		return null;
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

router.delete(
	'/api/admin/admins/:username',
	requireSession,
	requireAdmin,
	route(async (req, res) => {
		// Wie "admin remove" im Chat: sich selbst austragen geht nicht (Xyqra, 17.11.2026: hat sich selbst entfernt
		// und kam danach nicht mehr an die Admin-Seite)
		const username = String(req.params.username).toLowerCase();
		if (username === String(req.sess?.channel ?? '').toLowerCase()) {
			res.status(400).json({ error: "You can't remove yourself." });
			return;
		}
		const user = await bot.Users.get(username);
		if (user) {
			await bot.Users.setData(user, 'administrator', null);
		}
		res.json(await admins());
	}),
);

module.exports = router;
