/**
 * Erkennung der Emote-Spam-Welle in kickster1010 (alexmoderat, 15.11.2026: etwa 30 Tage alte Accounts mit generierten Namen
 * posten Emote-Reihen, kickster1010 wird viewgebottet). Alle drei Merkmale muessen zutreffen: nur Emotes, junges Konto,
 * generierter Name. Reine Funktionen, damit sie ohne Netz testbar sind.
 */
const MIN_EMOTES = 3;
const MAX_AGE_DAYS = 60;

/** Namen wie "legal_rodina", "doubtful_dolli", "supremenanci14", "carleneaesthetic": nur Kleinbuchstaben, hoechstens ein Unterstrich, optional Zahl am Ende */
const GENERATED_NAME = /^[a-z]{3,}(_[a-z]{3,})?\d{0,4}$/;
const isGeneratedName = (login) => {
	const name = String(login ?? '').toLowerCase();
	return name.length >= 8 && GENERATED_NAME.test(name);
};

/** Native Twitch-Emote-Bereiche aus dem IRC-Tag "emotes" ("25:0-4,6-10/1902:12-16") als Menge der abgedeckten Zeichen-Indizes */
const nativeEmoteRanges = (tag) => {
	const ranges = [];
	for (const part of String(tag ?? '').split('/')) {
		const [, positions] = part.split(':');
		for (const range of (positions ?? '').split(',')) {
			const [start, end] = range.split('-').map(Number);
			if (Number.isInteger(start) && Number.isInteger(end)) {
				ranges.push([start, end]);
			}
		}
	}
	return ranges;
};

/**
 * Besteht die Nachricht nur aus Emotes (native Twitch-Emotes laut Tag oder Namen aus dem 7TV-Set des Channels)? Mindestens MIN_EMOTES Woerter.
 * @param {string} text
 * @param {string} emoteTag IRC-Tag "emotes"
 * @param {Set<string>} knownNames Emote-Namen (7TV/BTTV/FFZ) des Channels
 */
const isEmoteOnly = (text, emoteTag, knownNames) => {
	const tokens = [...String(text ?? '').matchAll(/\S+/g)];
	if (tokens.length < MIN_EMOTES) {
		return false;
	}
	const native = nativeEmoteRanges(emoteTag);
	return tokens.every((m) => {
		const start = m.index;
		const end = m.index + m[0].length - 1;
		return native.some(([s, e]) => start >= s && end <= e) || knownNames.has(m[0]);
	});
};

const isYoungAccount = (age) => Boolean(age) && Number.isFinite(age.ageDays) && age.ageDays < MAX_AGE_DAYS;

/** Alle drei Merkmale zusammen */
const isEmoteWave = ({ text, emoteTag, knownNames, login, age }) => isEmoteOnly(text, emoteTag, knownNames) && isGeneratedName(login) && isYoungAccount(age);

module.exports = { MIN_EMOTES, MAX_AGE_DAYS, isGeneratedName, nativeEmoteRanges, isEmoteOnly, isYoungAccount, isEmoteWave };
