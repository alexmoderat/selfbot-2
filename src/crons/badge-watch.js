const { defineCron } = require('../clients/modules/timers.js');
const { fetchGlobalBadges, fetchGlobalEmotes, fetchBadgeEvents, BADGES_URL, EMOTES_URL } = require('../misc/streamdatabase.js');

/**
 * Meldet neue globale Twitch-Badges und Emotes in den Channels, die es im Dashboard eingeschaltet haben (ninou2, 13.11.2026:
 * "command disabled by default, the user enable from the website, add a custom message part"). Standardmaessig aus.
 * Bekannte Badges liegen in Redis; der erste Lauf merkt sich nur den Stand und meldet nichts.
 */
const SOURCES = [
	{ kind: 'badge', stateKey: 'badge-watch:known', fetch: fetchGlobalBadges },
	{ kind: 'emote', stateKey: 'badge-watch:known-emotes', fetch: fetchGlobalEmotes },
];
const STATE_TTL = 365 * 864e5;
const MAX_PER_RUN = 3; // mehr auf einmal = vermutlich Umbau der Seite, nicht echte Neuzugaenge

/** Neue Badges gegenueber dem bekannten Stand; known null = Erstlauf */
const newBadges = (badges, known) => (known ? badges.filter((i) => !known.has(i.key)) : []);

/** extra: optional { how, until } aus den Aktionen ("watch 30 min, until 2026-11-15") */
const formatBadge = (badge, custom = '', extra = null) => {
	const detail = [extra?.how, extra?.until ? `until ${extra.until}` : ''].filter(Boolean).join(', ');
	const text = `New global Twitch badge: ${badge.title}${badge.description ? ` - ${badge.description}` : ''}${detail ? ` [${detail}]` : ''} (${BADGES_URL})`;
	return custom ? `${text} ${custom}` : text;
};

const formatEmote = (emote, custom = '') => {
	const text = `New global Twitch emote: ${emote.title} (${EMOTES_URL})`;
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

const runSource = async (source, targets) => {
	const items = await source.fetch();
	const stored = await bot.Redis.getJSON(source.stateKey).catch(() => null);
	const known = Array.isArray(stored) ? new Set(stored) : null;
	const fresh = newBadges(items, known);
	await bot.Redis.setJSON(
		source.stateKey,
		items.map((i) => i.key),
		STATE_TTL,
	);
	if (fresh.length === 0) {
		return 0;
	} else if (fresh.length > MAX_PER_RUN) {
		console.warn(`[badge-watch] ${fresh.length} neue ${source.kind}s auf einmal, uebersprungen (Seite umgebaut?)`);
		return 0;
	}

	const format = source.kind === 'emote' ? formatEmote : formatBadge;
	// Wie/bis wann (nur Badges); faellt die Aktionen-Seite aus, kommt die Meldung ohne diese Angaben
	const events = source.kind === 'badge' ? await fetchBadgeEvents().catch(() => new Map()) : new Map();
	for (const item of fresh) {
		console.log(`[badge-watch] Neues ${source.kind}: ${item.key} - ${item.title} -> ${targets.length} Channel(s)`);
		for (const { channel, message } of targets) {
			await bot.Channels.send(channel, format(item, message, events.get(item.key) ?? null)).catch(() => {});
		}
	}

	return fresh.length;
};

const runBadgeWatch = async () => {
	const targets = await enabledChannels();
	let total = 0;
	for (const source of SOURCES) {
		// Eine Quelle darf ausfallen, ohne die andere zu blockieren
		total += await runSource(source, targets).catch((e) => {
			console.warn(`[badge-watch] ${source.kind}: ${e?.message ?? e}`);
			return 0;
		});
	}

	return total;
};

module.exports = defineCron({
	name: 'badge-watch',
	expression: '0 */10 * * * *',
	description: 'Announces new global Twitch badges and emotes (from streamdatabase.com) in channels that turned it on.',
	code: async function badgeWatch() {
		await runBadgeWatch().catch((e) => console.warn(`[badge-watch] ${e?.message ?? e}`));
	},
});

Object.assign(module.exports, { newBadges, formatBadge, formatEmote, runBadgeWatch });
