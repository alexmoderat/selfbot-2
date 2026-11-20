const { randomUUID } = require('node:crypto');
const { SupiError } = require('./error.js');

// Moderations-Banphrases (Chatter, die eine Phrase schreiben, werden gebannt/getimeoutet) aus sb-v2
// (v2/singletons/banphrases.ts + banphrases-maria.ts + Presets). Eine Tabelle Moderation_Phrase mit drei Ebenen:
// global (Channel und Preset NULL), Channel, Preset (gilt dort, wo das Preset aktiviert ist).
// Alles im Speicher; nach jeder Aenderung neu geladen, zusaetzlich jede Minute (fuer spaetere Dashboard-Schreibwege).

const RELOAD_INTERVAL = 60_000;

let phrases = [];
let presets = [];
/** Channel-ID -> aktive Preset-IDs */
let presetChannels = new Map();
let loaded = false;
let reloadTimer = null;

/* ---------- Abgleich (reine Funktionen) ---------- */

// Kompilierte Muster je Phrase (wie pajbots refresh_operator) - vorher entstand pro Nachricht und Phrase eine neue
// RegExp. Wird bei jedem loadData() geleert, damit geloeschte Phrasen nicht liegen bleiben. null = defekte Regex.
const compiled = new Map();

const compile = (phrase) => {
	const key = `${phrase.Is_Regex ? 'r' : 'w'}\0${phrase.Regex_Flags}\0${phrase.Phrase}`;
	const cached = compiled.get(key);
	if (cached !== undefined) {
		return cached;
	}

	let regex;
	try {
		if (phrase.Is_Regex) {
			// g/y machen test() an einer wiederverwendeten RegExp zustandsbehaftet (lastIndex) - jeder zweite Treffer fiele aus
			regex = new RegExp(phrase.Phrase, (phrase.Regex_Flags || 'i').replace(/[gy]/g, ''));
		} else {
			const escaped = phrase.Phrase.toLowerCase().replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
			// \b haengt an \w ([A-Za-z0-9_]) - bei kyrillischen Phrasen matcht es nie (Vorfall #ytposidonyt,
			// 22.08.2026: "соси" trotz Eintrag nicht erkannt). \p{L}/\p{N} decken jedes Skript ab.
			regex = new RegExp(`(?<![\\p{L}\\p{N}_])${escaped}(?![\\p{L}\\p{N}_])`, 'u');
		}
	} catch {
		regex = null; // defekte Regex in der DB darf nichts umwerfen
	}

	compiled.set(key, regex);
	return regex;
};

/** Eine Phrase gegen eine (bereits deobfuskierte, kleingeschriebene) Nachricht pruefen */
const matches = (message, phrase) => compile(phrase)?.test(message) ?? false;

/**
 * Wie hart eine Phrase straft (pajbots greater_than): permanent schlaegt jeden Timeout, sonst die laengere Dauer.
 * Eskalierende Phrasen zaehlen mit ihrer zweiten Stufe (Timeout, Standard 60 s) - der erste Treffer straft gar nicht.
 */
const severity = (phrase) => {
	if (phrase.Escalate) {
		return phrase.Duration ?? 60;
	}

	return phrase.Duration ?? Number.POSITIVE_INFINITY;
};

/** Von mehreren Treffern den haertesten; bei Gleichstand der erste (Reihenfolge global -> Channel -> Preset) */
const pickHarshest = (hits) => {
	let best = null;
	for (const hit of hits) {
		if (!best || severity(hit) > severity(best)) {
			best = hit;
		}
	}

	return best;
};

/** UUID oder UUID-Anfang (mind. 8 Hex-Zeichen) aus Benutzereingabe, sonst null (aus sb-v2) */
const uuidPrefix = (input) => {
	const s = String(input ?? '')
		.trim()
		.toLowerCase();
	if (s.length < 8 || s.length > 36 || !/^[0-9a-f-]+$/.test(s) || s.endsWith('-')) {
		return null;
	}

	for (let i = 0; i < s.length; i++) {
		if ((s[i] === '-') !== [8, 13, 18, 23].includes(i)) {
			return null;
		}
	}

	return s;
};

/** Suche in der Reihenfolge der Eindeutigkeit: UUID(-Anfang), Name, Wortlaut (aus sb-v2 lookupConditions) */
const findByKey = (list, key) => {
	const prefix = uuidPrefix(key);
	const lower = key.toLowerCase();
	const lookups = [];
	if (prefix) {
		lookups.push((i) => i.UUID.startsWith(prefix));
	}
	// Grund zuletzt: Dashboard-Phrasen haben oft nur Reason, keinen Name (delbp suchte frueher danach)
	lookups.push(
		(i) => i.Name?.toLowerCase() === lower,
		(i) => i.Phrase.toLowerCase() === lower,
		(i) => i.Reason !== '' && i.Reason.toLowerCase() === lower,
	);

	for (const lookup of lookups) {
		const hits = list.filter(lookup);
		if (hits.length > 0) {
			return hits;
		}
	}

	return [];
};

/* ---------- Laden ---------- */

const loadData = async () => {
	const [phraseRows, presetRows, presetChannelRows] = await Promise.all([
		bot.DB.ModerationPhrase.find({}).sort({ _id: 1 }).lean(),
		bot.DB.ModerationPreset.find({}).sort({ name: 1 }).lean(),
		bot.DB.ModerationPresetChannel.find({}, { preset: 1, channel: 1 }).lean(),
	]).then(([phraseDocs, presetDocs, presetChannelDocs]) => [
		phraseDocs.map((doc) => bot.DB.toRow('ModerationPhrase', doc)),
		presetDocs.map((doc) => bot.DB.toRow('ModerationPreset', doc)),
		presetChannelDocs.map((doc) => ({ Preset: doc.preset, Channel: doc.channel })),
	]);

	phrases = phraseRows.map((i) => ({
		...i,
		Is_Regex: Boolean(i.Is_Regex),
		Ignore_VIP: Boolean(i.Ignore_VIP),
		Ignore_Sub: Boolean(i.Ignore_Sub),
		Escalate: Boolean(i.Escalate),
	}));
	presets = presetRows.map((i) => ({ ...i, Auto_Enable: Boolean(i.Auto_Enable) }));

	const map = new Map();
	for (const row of presetChannelRows) {
		let set = map.get(row.Channel);
		if (!set) {
			set = new Set();
			map.set(row.Channel, set);
		}
		set.add(row.Preset);
	}
	presetChannels = map;
	compiled.clear();
	loaded = true;
};

const initialize = async () => {
	await loadData();
	reloadTimer ??= setInterval(() => {
		loadData().catch((e) => console.warn('[moderation-phrases] Neuladen fehlgeschlagen', e));
	}, RELOAD_INTERVAL);
	reloadTimer.unref();
};

const reload = async () => {
	await loadData();
};

/* ---------- Abfragen ---------- */

const getGlobal = () => phrases.filter((i) => i.Channel === null && i.Preset === null);
const getChannelPhrases = (channelId) => phrases.filter((i) => i.Channel === channelId);
const getPresetPhrases = (presetId) => phrases.filter((i) => i.Preset === presetId);
const getPresets = () => presets;
const getPreset = (name) => presets.find((i) => i.Name === name.toLowerCase()) ?? null;
const getChannelPresets = (channelId) => presets.filter((i) => presetChannels.get(channelId)?.has(i.ID));
const getPresetChannelIds = (presetId) => [...presetChannels.entries()].filter(([, set]) => set.has(presetId)).map(([channel]) => channel);

/**
 * Haerteste passende Phrase aus global, Channel und aktiven Presets (pajbots check_message). Vorher gewann der erste
 * Treffer - eine globale 60-s-Phrase schlug so einen Channel-Perma-Ban in derselben Nachricht.
 * Mit roles fallen Phrasen weg, gegen die der Chatter immun ist (VIP/Sub), statt dass die ganze Nachricht durchgeht.
 */
const findMatch = (channelId, message, roles = {}) => {
	if (!loaded) {
		return null;
	}

	const activePresets = presetChannels.get(channelId) ?? new Set();
	const hits = phrases.filter(
		(i) =>
			(i.Preset === null ? i.Channel === null || i.Channel === channelId : activePresets.has(i.Preset)) &&
			!(i.Ignore_VIP && roles.isVip) &&
			!(i.Ignore_Sub && roles.isSubscriber) &&
			matches(message, i),
	);

	// Reihenfolge global -> Channel -> Preset fuer den Gleichstand in pickHarshest
	const tier = (i) => (i.Preset !== null ? 2 : i.Channel !== null ? 1 : 0);
	hits.sort((a, b) => tier(a) - tier(b));

	return pickHarshest(hits);
};

// Treffer seit dem Start (fuer "moderation" im eval, wie pajbots banphrasesTriggered)
let hitsSinceStart = 0;

/** Jeder Treffer landet im Protokoll (fuer !bpstats), auch Channel- und Preset-Phrasen */
const recordHit = (phrase, channelId) => {
	hitsSinceStart++;
	bot.DB.createWithId('ModerationPhraseHit', { phrase: phrase.ID, phraseText: phrase.Phrase, channel: channelId, hit: new Date() }).catch((e) =>
		console.warn('[moderation-phrases] Treffer-Protokoll fehlgeschlagen', e),
	);
};

/* ---------- Aendern ---------- */

/**
 * Spalten fuer addPhrase. Neue Phrase: fehlende Felder bekommen Standardwerte. Vorhandene Phrase: nur angegebene
 * Felder aendern sich (pajbots banphrase.set) - vorher setzte ein zweites "caddbp chan foo" ohne length: die
 * Dauer auf null und machte aus einem Timeout still einen Perma-Ban, dazu Regex/VIP/Sub/Escalate zurueck.
 */

const phraseColumns = (data, isNew) => {
	const given = (value, fallback) => (value !== undefined ? value : isNew ? fallback : undefined);
	// Grund faellt auf den Namen zurueck (wie bisher); undefined = nicht angegeben
	const reason = data.reason ?? data.name;
	const columns = {
		Name: given(data.name, null),
		Reason: given(reason === undefined ? undefined : (reason ?? ''), ''),
		Duration: given(data.duration, null),
		Is_Regex: given(data.isRegex, false),
		Regex_Flags: given(data.regexFlags, 'i'),
		Ignore_VIP: given(data.ignoreVip, false),
		Ignore_Sub: given(data.ignoreSub, false),
		Escalate: given(data.escalate, false),
	};

	return Object.fromEntries(Object.entries(columns).filter((entry) => entry[1] !== undefined));
};

/** Neue Phrase; existiert der Wortlaut in derselben Ebene schon, werden nur die angegebenen Felder geaendert */
const addPhrase = async (scope, data) => {
	if (scope.channel && scope.preset) {
		throw new SupiError({ message: 'A phrase cannot belong to a channel and a preset at the same time' });
	}

	const channel = scope.channel ?? null;
	const preset = scope.preset ?? null;
	const existing = phrases.find((i) => i.Channel === channel && i.Preset === preset && i.Phrase === data.phrase);

	const columns = phraseColumns(data, !existing);
	const fields = bot.DB.fromRow('ModerationPhrase', columns);
	let uuid = existing?.UUID ?? null;
	if (existing) {
		if (Object.keys(fields).length > 0) {
			await bot.DB.ModerationPhrase.updateOne({ _id: existing.ID }, { $set: { ...fields, lastUpdate: new Date() } });
			await reload();
		}
	} else {
		uuid = randomUUID();
		await bot.DB.createWithId('ModerationPhrase', {
			uuid,
			channel,
			preset,
			phrase: data.phrase,
			addedBy: data.addedBy ?? null,
			created: new Date(),
			...fields,
		});
		await reload();
	}

	return uuid;
};

/** Aendert eine Phrase; key = UUID(-Anfang), Name oder Wortlaut innerhalb der Ebene */
const updatePhrase = async (list, key, changes) => {
	const hits = findByKey(list, key);
	if (hits.length === 0) {
		return { ok: false, reason: 'notfound' };
	} else if (hits.length > 1) {
		return { ok: false, reason: 'ambiguous' };
	}

	const target = hits[0];
	if (changes.phrase !== undefined && list.some((i) => i.ID !== target.ID && i.Phrase === changes.phrase)) {
		return { ok: false, reason: 'duplicate' };
	}

	const set = { lastUpdate: new Date() };
	if (changes.phrase !== undefined) {
		Object.assign(set, { phrase: changes.phrase, isRegex: Boolean(changes.isRegex), regexFlags: changes.regexFlags ?? 'i' });
	}
	if (changes.name !== undefined) {
		Object.assign(set, { name: changes.name, reason: changes.name });
	}
	if (changes.duration !== undefined) {
		set.duration = changes.duration;
	}
	if (changes.ignoreVip !== undefined) {
		set.ignoreVip = changes.ignoreVip;
	}
	if (changes.ignoreSub !== undefined) {
		set.ignoreSub = changes.ignoreSub;
	}
	if (changes.escalate !== undefined) {
		set.escalate = changes.escalate;
	}

	await bot.DB.ModerationPhrase.updateOne({ _id: target.ID }, { $set: set });
	await reload();
	return { ok: true, uuid: target.UUID };
};

const removePhrase = async (phrase) => {
	await bot.DB.ModerationPhrase.deleteOne({ _id: phrase.ID });
	await reload();
};

const changedFields = (changes) => {
	const out = [];
	if (changes.phrase !== undefined) out.push('trigger');
	if (changes.name !== undefined) out.push('name');
	if (changes.duration !== undefined) out.push('length');
	if (changes.ignoreVip !== undefined) out.push('ignorevip');
	if (changes.ignoreSub !== undefined) out.push('ignoresub');
	if (changes.escalate !== undefined) out.push('escalate');
	return out;
};

/* ---------- Presets ---------- */

const createPreset = async (name, description, createdBy) => {
	await bot.DB.createWithId('ModerationPreset', { name: name.toLowerCase(), description, createdBy, created: new Date() });
	await reload();
};

const deletePreset = async (preset) => {
	// MariaDB loeschte die Zuordnungen per Fremdschluessel mit
	await bot.DB.ModerationPresetChannel.deleteMany({ preset: preset.ID });
	await bot.DB.ModerationPreset.deleteOne({ _id: preset.ID });
	await reload();
};

const setPresetAutoEnable = async (preset, value) => {
	await bot.DB.ModerationPreset.updateOne({ _id: preset.ID }, { $set: { autoEnable: value } });
	await reload();
};

const enablePreset = async (preset, channelId, enabledBy) => {
	await bot.DB.ModerationPresetChannel.updateOne({ preset: preset.ID, channel: channelId }, { $setOnInsert: { enabledBy, enabled: new Date() } }, { upsert: true });
	await reload();
};

const disablePreset = async (preset, channelId) => {
	const active = presetChannels.get(channelId)?.has(preset.ID) ?? false;
	await bot.DB.ModerationPresetChannel.deleteOne({ preset: preset.ID, channel: channelId });
	await reload();
	return active;
};

/** Momentaufnahme des Phrasen-Speichers (fuer "moderation" im eval) */
const getStats = () => ({
	banphrasesTriggered: hitsSinceStart,
	phrases: {
		global: getGlobal().length,
		channel: phrases.filter((i) => i.Channel !== null).length,
		preset: phrases.filter((i) => i.Preset !== null).length,
		regex: phrases.filter((i) => i.Is_Regex).length,
	},
	presets: presets.length,
	reloadInterval: RELOAD_INTERVAL,
});

/** Trefferzahlen je Phrasen-Wortlaut aus dem Protokoll (fuer !bpstats) */
const getHitStats = async () => {
	const rows = await bot.DB.ModerationPhraseHit.aggregate([{ $group: { _id: '$phraseText', hits: { $sum: 1 }, firstHit: { $min: '$hit' }, lastHit: { $max: '$hit' } } }]);

	return rows.map((i) => ({
		phrase: i._id,
		hits: Number(i.hits),
		firstHit: new Date(i.firstHit),
		lastHit: new Date(i.lastHit),
	}));
};

module.exports = {
	matches,
	severity,
	pickHarshest,
	uuidPrefix,
	findByKey,
	loadData,
	initialize,
	getGlobal,
	getChannelPhrases,
	getPresetPhrases,
	getPresets,
	getPreset,
	getChannelPresets,
	getPresetChannelIds,
	findMatch,
	recordHit,
	phraseColumns,
	addPhrase,
	updatePhrase,
	removePhrase,
	changedFields,
	createPreset,
	deletePreset,
	setPresetAutoEnable,
	enablePreset,
	disablePreset,
	getStats,
	getHitStats,
};
