const { Logger } = require('../../../misc/logger.js');
const { got } = require('../../../token/got.js');

const { defineChatModule } = require('../chat-modules.js');

const { fetchTwitchUser } = require('../../../util/twitch/twitch-utils.js');
const { enqueueWatch, findHashMatch, recordHash } = require('../../../util/fake-live.js');
const { autoBan, targetFromChannel } = require('../../../util/moderation.js');
const { addToWatchlist } = require('../../../util/watchlist.js');
const { formatAutoBanReason } = require('../../../util/ban-reason.js');
const { getMonitoredStatus } = require('../../../token/catquery-api.js');
const { FAKE_LIVE_MAX_DISTANCE, dHashFromBuffer } = require('../../../util/image-hash.js');
const { fetchStreamThumbnailUrl } = require('../../../token/twitch-lists.js');
const { reportFakeLive } = require('../../../token/gql.js');

/**
 * Follow-Bot-Schutz bei neuen Followern (EventSub channel.follow), aus sb-v2s singletons/follow-announce.ts.
 * Nur in Channels mit !followprotection on (Channel_Data followProtection). Drei Pruefungen:
 *  1. Follow-Bot: zufaelliger Name UND Standard-Profilbild -> Ban (kletztenbrot, 15.08.2026: 99/100 Follower)
 *  2. CatQuery "monitored" -> nur auf die Watchlist, kein Ban (False-Positive-Vorfall: 4 Streamer zu Unrecht gebannt)
 *  3. Fake-Live: Thumbnail-Hash gleicht dem Live-Stream eines Followers in einem ANDEREN Channel -> Ban + Meldung
 *     (alexmoderat, 30.09.2026: Meng2xPlays + TaranTanod007 zeigten exakt dasselbe Video). Ohne Treffer auf die
 *     Warteliste, der Cron fake-live-watch tastet bis zu 1 h nach.
 */

// Nur Kleinbuchstaben, keine Trenner, 9-16 Buchstaben, optional bis zu 4 Ziffern ("abalaktedeja")
const FOLLOW_BOT_NAME_PATTERN = /^[a-z]{9,16}\d{0,4}$/;
const FOLLOW_BOT_REASON = 'Follow-bot account (auto-generated name pattern + default profile picture)';

const checkFollowBot = async (channel, userId, login) => {
	if (!FOLLOW_BOT_NAME_PATTERN.test(login)) {
		return;
	}

	const user = await fetchTwitchUser(userId, { byId: true }).catch(() => null);
	if (!user?.profile_image_url.includes('user-default-pictures')) {
		return;
	}

	const ok = await autoBan(targetFromChannel(channel, userId, login), {
		reason: FOLLOW_BOT_REASON,
		publicReason: 'Follow-bot account',
		status: 'FOLLOW_BOT',
	});
	Logger.warn(`[follow-protection] ${ok ? 'Gebannt' : 'Ban fehlgeschlagen'}: ${login} in #${channel.name}`);
};

const checkCatqueryMonitored = async (channel, login) => {
	const status = await getMonitoredStatus(login);
	if (!status?.monitored) {
		return;
	}

	await addToWatchlist(channel, login, `CatQuery: ${status.reason || 'flagged as monitored'}`, 'CatQuery-Check').catch(() => {});
	Logger.warn(`[follow-protection] ${login} in #${channel.name} von CatQuery geflaggt (${status.reason}) - auf die Watchlist`);
};

/** Thumbnail holen und hashen; null, wenn nicht live oder nicht lesbar */
const hashLiveThumbnail = async (userId) => {
	const url = await fetchStreamThumbnailUrl(userId).catch(() => null);
	if (!url) {
		return null;
	}

	const response = await got('Global')({ url, responseType: 'buffer', timeout: { request: 8000 } }).catch(() => null);
	if (!response?.ok) {
		return null;
	}

	return await dHashFromBuffer(Buffer.from(response.rawBody)).catch(() => null);
};

/** Ban + Meldung bei Twitch nach einem Fake-Live-Treffer (auch vom Cron genutzt) */
const punishFakeLive = async (platform, channel, userId, userName, match) => {
	const label = `fake live stream (identical video to #${match.channel}, distance ${match.distance}/64)`;
	const ok = await autoBan(targetFromChannel(channel, userId, userName), {
		reason: formatAutoBanReason(label, platform.selfName),
		publicReason: label,
		status: 'FAKE_LIVE',
	});
	Logger.warn(`[follow-protection] ${ok ? 'Gebannt' : 'Ban fehlgeschlagen'} (Fake-Live-Treffer mit #${match.channel}, Distanz ${match.distance}): ${userName} in #${channel.name}`);

	if (!process.env.TWITCH_WEB_TOKEN) {
		return;
	}

	const comment = `Automated detection: identical video content to a live stream in #${match.channel} ` + `(perceptual hash distance ${match.distance}/64), declared under a mismatched category.`;
	const error = await reportFakeLive(userId, comment).catch((e) => (e instanceof Error ? e.message : String(e)));
	Logger.info(`[follow-protection] Twitch-Meldung fuer ${userId}: ${error ? `fehlgeschlagen (${error})` : 'gesendet'}`);
};

const checkFakeLiveStream = async (platform, channel, userId, userName) => {
	const hash = await hashLiveThumbnail(userId);
	if (!hash) {
		return; // nicht live - kein Fake-Live-Risiko
	}

	const match = await findHashMatch(channel.name, hash, FAKE_LIVE_MAX_DISTANCE).catch(() => null);
	await recordHash(channel.name, userId, hash).catch((e) => Logger.warn('[follow-protection] Hash-Eintrag fehlgeschlagen', e));
	if (!match) {
		await enqueueWatch(channel.name, userId).catch((e) => Logger.warn('[follow-protection] Warteliste fehlgeschlagen', e));
		return;
	}

	await punishFakeLive(platform, channel, userId, userName, match);
};

module.exports = defineChatModule({
	name: 'follow-protection',
	description: 'Bans likely follow-bot accounts and fake-live bot farms on follow - only where followprotection is on.',
	scope: 'global',
	handlers: {
		follow: async (context) => {
			const { channel, userId, userName, platform } = context;
			if (channel.mode !== 'Moderator' || (await bot.Channels.getData(channel, 'followProtection')) !== true) {
				return;
			}

			await checkFollowBot(channel, userId, userName);
			await checkCatqueryMonitored(channel, userName);
			await checkFakeLiveStream(platform, channel, userId, userName);
		},
	},
});

Object.assign(module.exports, { FOLLOW_BOT_NAME_PATTERN, FOLLOW_BOT_REASON, hashLiveThumbnail, punishFakeLive });
