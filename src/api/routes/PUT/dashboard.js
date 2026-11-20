const express = require('express');
const {
	cleanHandle,
	cleanTimes,
	raidNotifier,
	requireSession,
	issuer,
	route,
	titleNotifyRows,
	tweetNotifyRows,
	bodyFields,
	urlChannelId,
	RAID_TEXT_MAX,
	raidRoute,
} = require('../../dashboard.js');

const router = express.Router();

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

// Zusatztext eines bestehenden Alarms aendern (ninou2, 13.11.2026: "content area of the message ... should be clickable")
router.put(
	'/api/tweetnotify/:account/:channel',
	requireSession,
	route(async (req, res) => {
		const me = await issuer(req);
		const channelId = urlChannelId(req);
		if (channelId !== null) {
			await bot.DB.TweetNotify.updateOne({ channel: channelId, userAlias: me, account: cleanHandle(req.params.account) }, { $set: bodyFields(req.body) });
		}
		res.json(await tweetNotifyRows(me));
	}),
);

router.put(
	'/api/raidnotify/items/:id',
	requireSession,
	raidRoute(async (channel, req) => {
		const id = Number(req.params.id);
		const { on, seconds, text, times } = req.body ?? {};
		await raidNotifier.updateItems(channel, (items) =>
			items.map((item) => {
				if (item.id !== id) {
					return item;
				}
				const next = { ...item };
				if (typeof on === 'boolean') {
					next.on = on;
				}
				if (seconds !== undefined) {
					next.seconds = raidNotifier.clampLead(seconds);
				}
				if (text !== undefined) {
					// null / leer = Standardtext
					next.text =
						typeof text === 'string'
							? text
									.replaceAll(/[\r\n]+/g, ' ')
									.trim()
									.slice(0, RAID_TEXT_MAX) || null
							: null;
				}
				if (times !== undefined) {
					next.times = cleanTimes(times);
				}
				return next;
			}),
		);
		return null;
	}),
);

module.exports = router;
