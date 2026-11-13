const { defineCron } = require('../clients/modules/timers.js');
const { fetchGlobalBadges, BADGES_URL } = require('../misc/streamdatabase.js');

/**
 * Meldet neue globale Twitch-Badges in den Channels, die es im Dashboard eingeschaltet haben (ninou2, 13.11.2026:
 * "command disabled by default, the user enable from the website, add a custom message part"). Standardmaessig aus.
 * Bekannte Badges liegen in Redis; der erste Lauf merkt sich nur den Stand und meldet nichts.
 */
const STATE_KEY = 'badge-watch:known';
const STATE_TTL = 365 * 864e5;
const MAX_PER_RUN = 3; // mehr auf einmal = vermutlich Umbau der Seite, nicht echte Neuzugaenge

/** Neue Badges gegenueber dem bekannten Stand; known null = Erstlauf */
const newBadges = (badges, known) => (known ? badges.filter((i) => !known.has(i.key)) : []);

const formatBadge = (badge, custom = '') => {
	const text = `New global Twitch badge: ${badge.title}${badge.description ? ` - ${badge.description}` : ''} (${BADGES_URL})`;
	return custom ? `${text} ${custom}` : text;
};

const enabledChannels = async () => {
	const result = [];
	for (const channel of bot.Channels.all()) {
		if (channel.Platform !== bot.Twitch || channel.mode === 'Inactive') {
			continue;
		}
		const settings = await bot.Channels.getData(channel, 'badgeAlerts');
		if (settings?.enabled) {
			result.push({ channel, message: typeof settings.message === 'string' ? settings.message : '' });
		}
	}

	return result;
};

const runBadgeWatch = async () => {
	const badges = await fetchGlobalBadges();
	const stored = await bot.Redis.getJSON(STATE_KEY).catch(() => null);
	const known = Array.isArray(stored) ? new Set(stored) : null;
	const fresh = newBadges(badges, known);
	await bot.Redis.setJSON(
		STATE_KEY,
		badges.map((i) => i.key),
		STATE_TTL,
	);
	if (fresh.length === 0) {
		return 0;
	} else if (fresh.length > MAX_PER_RUN) {
		console.warn(`[badge-watch] ${fresh.length} neue Badges auf einmal, uebersprungen (Seite umgebaut?)`);
		return 0;
	}

	const targets = await enabledChannels();
	for (const badge of fresh) {
		console.log(`[badge-watch] Neues Badge: ${badge.key} - ${badge.title} -> ${targets.length} Channel(s)`);
		for (const { channel, message } of targets) {
			await bot.Channels.send(channel, formatBadge(badge, message)).catch(() => {});
		}
	}

	return fresh.length;
};

module.exports = defineCron({
	name: 'badge-watch',
	expression: '0 */10 * * * *',
	description: 'Announces new global Twitch badges (from streamdatabase.com) in channels that turned it on.',
	code: async function badgeWatch() {
		await runBadgeWatch().catch((e) => console.warn(`[badge-watch] ${e?.message ?? e}`));
	},
});

Object.assign(module.exports, { newBadges, formatBadge, runBadgeWatch });
