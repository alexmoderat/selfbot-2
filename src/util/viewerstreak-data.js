const { topListHint, formatSharedDate, formatShortDate } = require('./tracking-format.js');
const { fetchTwitchUser } = require('./twitch/twitch-utils.js');
const stats = require('./channel-stats.js');

/**
 * Letzter bekannter Watch-Streak eines Zuschauers im Channel (aus dem Command viewerstreak, "vs"), als Daten fuer die
 * Variablen {vs_*} der Custom Commands. vs_kind: nochannel | top | notfound | none | ok. Nur dort aufgezeichnet, wo der Bot ist.
 */
const getViewerStreak = async ({ userRaw, channelName, channelId, senderName }) => {
	if (!channelId) {
		return { kind: 'nochannel' };
	}

	const hint = topListHint(userRaw);
	if (hint) {
		return { kind: 'top', hint };
	}

	const login = (userRaw ?? senderName ?? '').replace(/^@/, '').toLowerCase();
	const base = { login, channel: channelName };
	const user = await fetchTwitchUser(login).catch(() => null);
	if (!user) {
		return { ...base, kind: 'notfound' };
	}

	const row = await stats.getWatchStreak(channelId, user.id);
	if (!row) {
		return { ...base, kind: 'none' };
	}

	const best = row.Best_Value && row.Best_Seen_At ? ` [his longest streak ever was at > ${row.Best_Value} < on ${formatShortDate(row.Best_Seen_At)}]` : '';
	return { ...base, kind: 'ok', value: String(row.Value), seen: formatSharedDate(row.Seen_At), best };
};

module.exports = { getViewerStreak };
