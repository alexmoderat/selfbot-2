/**
 * Ban-Entscheidung fuer bei CatQuery ueberwachte Accounts, aus sb-v2s v2/utils/monitored-ban.ts.
 * Nicht jeder Grund taugt fuer einen automatischen Ban: "Live Self-Promo Bot" trifft auch echte Streamer,
 * die nur ihr Emote posten (firelina) - dort bleibt es beim Hinweis. In den eigenen Radar-Channels gilt jeder
 * Grund (alexmoderat, 26.09.2026: "in alexmoderat und alex_sbottats kann ruhig mit self promo").
 */
const BAN_ALL_REASONS_CHANNELS = ['alexmoderat', 'alex_sbottats'];
const SPARED_REASON = /self[\s-]?promo/i;

const shouldBanMonitored = (status, channel, options = {}) => {
	if (!status?.monitored) {
		return false;
	}

	const all = options.banAllChannels ?? BAN_ALL_REASONS_CHANNELS;
	if (all.includes(channel.toLowerCase())) {
		return true;
	}

	return !(options.sparedReason ?? SPARED_REASON).test(status.reason ?? '');
};

const cut = (text, length) => (text.length > length ? `${text.slice(0, length - 1)}…` : text);

/** Grund fuer Twitch (wird von formatAutoBanReason als "Automated Ban by …" gerahmt) */
const monitoredBanLabel = (reason) => `Monitored by CatQuery${reason ? ` - ${cut(reason.replace(/\s+/g, ' ').trim(), 80)}` : ''}`;

/** Begrenzt Bans pro Zeitfenster - falls die Liste bei CatQuery einmal Amok laeuft, bleibt der Schaden klein */
const createBanLimiter = (max = 10, windowMs = 60_000, now = Date.now) => {
	let times = [];
	return {
		tryTake() {
			const t = now();
			times = times.filter((i) => t - i < windowMs);
			if (times.length >= max) {
				return false;
			}

			times.push(t);
			return true;
		},
	};
};

module.exports = { BAN_ALL_REASONS_CHANNELS, SPARED_REASON, shouldBanMonitored, monitoredBanLabel, createBanLimiter };
