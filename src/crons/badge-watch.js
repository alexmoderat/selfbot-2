const { defineCron } = require('../clients/modules/timers.js');
const { recordRecent } = require('../misc/badge-history.js');
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
const MAX_PER_RUN = 40; // deutlich mehr auf einmal = vermutlich Umbau der Seite, nicht echte Neuzugaenge
const CHUNK_LIMIT = 420; // Zeichen je Chat-Nachricht bei Sammelmeldungen

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

/**
 * Mehrere neue auf einmal = eine Sammelmeldung (ninou2, 13.11.2026: "benachrichtigt werden wenn mehrere kommen auf 1x"),
 * bei Bedarf auf mehrere Nachrichten verteilt. Ein einzelner Neuzugang behaelt die ausfuehrliche Meldung.
 */
const formatMany = (kind, items, custom = '', events = new Map()) => {
	const url = kind === 'emote' ? EMOTES_URL : BADGES_URL;
	const names = items.map((item) => {
		const extra = kind === 'badge' ? events.get(item.key) : null;
		const detail = [extra?.how, extra?.until ? `until ${extra.until}` : ''].filter(Boolean).join(', ');
		return detail ? `${item.title} [${detail}]` : item.title;
	});
	const tail = ` (${url})${custom ? ` ${custom}` : ''}`;
	const messages = [];
	let current = [];
	for (const name of names) {
		if (current.length > 0 && [...current, name].join(', ').length > CHUNK_LIMIT) {
			messages.push(current);
			current = [];
		}
		current.push(name);
	}
	if (current.length > 0) {
		messages.push(current);
	}

	return messages.map((chunk, i) => `New global Twitch ${kind}s${messages.length > 1 ? ` (${i + 1}/${messages.length})` : ` (${items.length})`}: ${chunk.join(', ')}${i === messages.length - 1 ? tail : ''}`);
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

const runSource = async (source, getTargets) => {
	const items = await source.fetch();
	const stored = await bot.Redis.getJSON(source.stateKey).catch(() => null);
	const known = Array.isArray(stored) ? new Set(stored) : null;
	const fresh = newBadges(items, known);
	await bot.Redis.setJSON(
		source.stateKey,
		items.map((i) => i.key),
		STATE_TTL,
	);
	console.log(`[badge-watch] ${source.kind}s: ${items.length} bekannt, ${fresh.length} neu${known ? '' : ' (Erstlauf, nur Stand gemerkt)'}`);
	if (fresh.length === 0) {
		return 0;
	} else if (fresh.length > MAX_PER_RUN) {
		console.warn(`[badge-watch] ${fresh.length} neue ${source.kind}s auf einmal, uebersprungen (Seite umgebaut?)`);
		return 0;
	}

	const targets = await getTargets();
	const format = source.kind === 'emote' ? formatEmote : formatBadge;
	// Wie/bis wann (nur Badges); faellt die Aktionen-Seite aus, kommt die Meldung ohne diese Angaben
	const events = source.kind === 'badge' ? await fetchBadgeEvents().catch(() => new Map()) : new Map();
	// Verlauf fuer !lastbadge/!lastemote, auch wenn gerade kein Channel den Alert eingeschaltet hat
	await recordRecent(
		source.kind,
		fresh.map((i) => ({ title: i.title, description: source.kind === 'badge' ? i.description : '', ...(events.get(i.key) ?? {}) })),
	).catch((e) => console.warn(`[badge-watch] Verlauf: ${e?.message ?? e}`));
	for (const item of fresh) {
		console.log(`[badge-watch] Neues ${source.kind}: ${item.key} - ${item.title} -> ${targets.length} Channel(s)`);
	}
	for (const { channel, message } of targets) {
		const texts = fresh.length === 1 ? [format(fresh[0], message, events.get(fresh[0].key) ?? null)] : formatMany(source.kind, fresh, message, events);
		for (const text of texts) {
			await bot.Channels.send(channel, text).catch(() => {});
		}
	}

	return fresh.length;
};

const runBadgeWatch = async () => {
	// Channel-Liste nur holen, wenn es etwas zu melden gibt; der Stand wird in jedem Fall gemerkt
	let cached = null;
	const getTargets = async () => (cached ??= await enabledChannels());
	let total = 0;
	for (const source of SOURCES) {
		// Eine Quelle darf ausfallen, ohne die andere zu blockieren
		total += await runSource(source, getTargets).catch((e) => {
			console.warn(`[badge-watch] ${source.kind}: ${e?.message ?? e}`);
			return 0;
		});
	}

	return total;
};

module.exports = defineCron({
	name: 'badge-watch',
	expression: '0 */3 * * * *', // alle 3 Minuten (ninou2, 13.11.2026: "is that the minimum time? can it go lower")
	description: 'Announces new global Twitch badges and emotes (from streamdatabase.com) in channels that turned it on.',
	code: async function badgeWatch() {
		await runBadgeWatch().catch((e) => console.warn(`[badge-watch] ${e?.message ?? e}`));
	},
});

Object.assign(module.exports, { newBadges, formatBadge, formatEmote, formatMany, runBadgeWatch });
