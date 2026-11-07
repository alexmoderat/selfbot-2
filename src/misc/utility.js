const { randomInt } = require('node:crypto');

// Ersatz fuer supi-core Utils (AGPL-3.0, Supinic): nur die Funktionen, die der Bot benutzt, gleiche Ausgaben

const timeUnits = {
	y: { d: 365, h: 8760, m: 525_600, s: 31_536_000, ms: 31_536_000_000 },
	d: { h: 24, m: 1440, s: 86_400, ms: 86_400_000 },
	h: { m: 60, s: 3600, ms: 3_600_000 },
	m: { s: 60, ms: 60_000 },
	s: { ms: 1000 },
};

const linkRegex = /(((http|https):\/\/)?[-a-zA-Z0-9@:%._+~#=]{1,256}\.[a-z]{2,6}\b([-a-zA-Z0-9@:%_+.~#?&/=]*))/gi;

const round = (number, places = 0, options = {}) => {
	const direction = options.direction ?? 'round';
	if (!['ceil', 'floor', 'round', 'trunc'].includes(direction)) {
		throw new Error(`Invalid round direction ${direction}`);
	}
	return Math[direction](number * 10 ** places) / 10 ** places;
};

/** "5m, 3s ago" / "in 2h, 10m" wie Supibot */
const timeDelta = (input, skipAffixes = false, respectLeapYears = false, deltaTo = new Date()) => {
	const target = new Date(input.valueOf());
	if (target.valueOf() === deltaTo.valueOf()) {
		return 'right now!';
	}

	let string;
	const delta = Math.abs(deltaTo.valueOf() - target.valueOf());
	const [prefix, suffix] = target > deltaTo ? ['in ', ''] : ['', ' ago'];

	if (delta < timeUnits.s.ms) {
		string = `${delta}ms`;
	} else if (delta < timeUnits.m.ms) {
		string = `${round(delta / timeUnits.s.ms, 2)}s`;
	} else if (delta < timeUnits.h.ms) {
		const trimmed = round(delta, -3);
		const minutes = Math.trunc(trimmed / timeUnits.m.ms);
		const seconds = Math.trunc((trimmed / timeUnits.s.ms) % timeUnits.m.s);
		string = `${minutes}m, ${seconds}s`;
	} else if (delta < timeUnits.d.ms) {
		const trimmed = round(delta, -3);
		const hours = Math.trunc(trimmed / timeUnits.h.ms);
		const minutes = Math.trunc(trimmed / timeUnits.m.ms) % timeUnits.h.m;
		string = `${hours}h, ${minutes}m`;
	} else if (delta < timeUnits.y.ms) {
		const trimmed = round(delta, -3);
		const days = Math.trunc(trimmed / timeUnits.d.ms);
		const hours = Math.trunc(trimmed / timeUnits.h.ms) % timeUnits.d.h;
		string = `${days}d, ${hours}h`;
	} else if (respectLeapYears) {
		const [earlier, later] = deltaTo < target ? [deltaTo, target] : [target, deltaTo];
		const trimmed = round(delta, -3);
		const laterRounded = new Date(earlier.valueOf() + trimmed);
		let years = laterRounded.getUTCFullYear() - earlier.getUTCFullYear();
		const earlierPlusYears = new Date(earlier.valueOf());
		earlierPlusYears.setUTCFullYear(earlierPlusYears.getUTCFullYear() + years);
		while (earlierPlusYears.valueOf() > later.valueOf()) {
			earlierPlusYears.setUTCFullYear(earlierPlusYears.getUTCFullYear() - 1);
			years--;
		}
		const remainingDelta = round(laterRounded.valueOf() - earlierPlusYears.valueOf(), -4);
		string = `${years}y, ${Math.trunc(remainingDelta / timeUnits.d.ms)}d`;
	} else {
		const trimmed = round(delta, -4);
		const years = Math.trunc(trimmed / timeUnits.y.ms);
		const days = Math.trunc(trimmed / timeUnits.d.ms) % timeUnits.y.d;
		string = `${years}y, ${days}d`;
	}

	return skipAffixes ? string : prefix + string + suffix;
};

const wrapString = (string, length, options = {}) => {
	if (!options.keepWhitespace) {
		string = string.replaceAll(/\r?\n/g, ' ').replaceAll(/\s+/g, ' ');
	}
	return string.length >= length ? `${string.slice(0, length - 1)}…` : string;
};

/** Ganzzahl zwischen min und max, beide eingeschlossen */
const random = (min, max) => randomInt(min, max + 1);
const randArray = (array) => (array.length === 0 ? undefined : array[random(0, array.length - 1)]);
const shuffleArray = (array) => {
	const copy = [...array];
	for (let i = copy.length - 1; i > 0; i--) {
		const j = random(0, i);
		[copy[i], copy[j]] = [copy[j], copy[i]];
	}
	return copy;
};

const isValidInteger = (input, minLimit = 0) => typeof input === 'number' && Number.isFinite(input) && Math.trunc(input) === input && input >= minLimit;

/** [erfuellt, nicht erfuellt] */
const splitByCondition = (array, filter) => {
	const yes = [];
	const no = [];
	array.forEach((item, index) => (filter(item, index, array) ? yes : no).push(item));
	return [yes, no];
};

const groupDigits = (number, separator = ' ') => new Intl.NumberFormat('en-US').format(number).replaceAll(',', separator);

/** Teilt nach ganzen Woertern auf hoechstens messageCount Nachrichten mit je limit Zeichen */
const partitionString = (message, limit, messageCount) => {
	if (!isValidInteger(limit)) {
		throw new Error('Limit must be a positive integer');
	}

	const words = [];
	const regex = new RegExp(`.{1,${limit}}`, 'g');
	for (const rawWord of message.split(' ')) {
		if (rawWord.length > limit) {
			words.push(...(rawWord.match(regex) ?? []));
		} else {
			words.push(rawWord);
		}
	}

	const result = [];
	let buffer = [];
	let counter = 0;
	let messages = 1;
	let loopBroken = false;
	for (const word of words) {
		buffer.push(word);
		counter += word.length + 1;
		if (counter >= limit) {
			counter = 0;
			buffer.pop();
			result.push(buffer.join(' '));
			buffer = [word];
			messages++;
		}
		if (messages > messageCount) {
			loopBroken = true;
			break;
		}
	}
	if (!loopBroken) {
		result.push(buffer.join(' '));
	}
	return result;
};

const replaceLinks = (string, replacement = '[LINK]') => string.replaceAll(linkRegex, replacement);
const escapeRegExp = (string) => string.replaceAll(/([.+*?^$()[\]{}|\\])/g, '\\$1');
const capitalize = (string) => string[0].toUpperCase() + string.slice(1).toLowerCase();
const zf = (number, padding) => String(number).padStart(padding, '0');

/** "2026-11-07 19:40:12.345" wie SupiDate.sqlDateTime (UTC) */
const sqlDateTime = (date = new Date()) => date.toISOString().replace('T', ' ').replace('Z', '');

const tag = {
	/** Mehrzeilige Template-Strings zu einer Zeile */
	trim: (strings, ...values) => {
		const result = [];
		for (let i = 0; i < strings.length; i++) {
			result.push(strings[i].replaceAll(/\s+/g, ' '), values[i] ?? '');
		}
		return result.join('').trim();
	},
};

module.exports = {
	timeUnits,
	round,
	timeDelta,
	wrapString,
	random,
	randArray,
	shuffleArray,
	isValidInteger,
	splitByCondition,
	groupDigits,
	partitionString,
	replaceLinks,
	escapeRegExp,
	capitalize,
	zf,
	sqlDateTime,
	tag,
};
