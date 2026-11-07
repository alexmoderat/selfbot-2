const { got } = require('../token/got.js');
const { randomInt: cryptoRandomInt } = require('node:crypto');
const { parse: chronoParse } = require('chrono-node');
const { SupiError } = require('./error.js');
const { uploadToOwnHaste } = require('./haste.js');

// Wie Supibots utils/command-utils.ts
/** Unsichtbares Zeichen, das in Namen eingefuegt einen Twitch-Ping verhindert */
const TWITCH_ANTIPING_CHARACTER = '\u034F';
const MAX_SAFE_RANGE = 281_474_976_710_655;

/** Zufallszahl zwischen min und max (beide inklusive), auch fuer Bereiche ueber crypto.randomInt hinaus */
const randomInt = (min, max) => {
	if (Math.abs(min) > Number.MAX_SAFE_INTEGER || Math.abs(max) > Number.MAX_SAFE_INTEGER) {
		throw new SupiError({
			message: 'Integer range exceeded',
			args: { min, max },
		});
	}

	const range = max - min;
	if (range <= MAX_SAFE_RANGE) {
		return cryptoRandomInt(min, max + 1);
	}

	const baseRoll = cryptoRandomInt(0, MAX_SAFE_RANGE);
	const multiplier = range / MAX_SAFE_RANGE;
	const roll = Math.trunc(baseRoll * multiplier);

	return min + roll;
};

/**
 * Wie Supibots fetchGeoLocationData, aber ueber Open-Meteos Geocoding statt Google
 * (kein kostenpflichtiger Google-Key vorhanden). Nur Ortssuche per Name.
 */
const fetchGeoLocationData = async (query) => {
	const response = await got('GenericAPI')({
		url: 'https://geocoding-api.open-meteo.com/v1/search',
		searchParams: { name: query, count: 1, language: 'en', format: 'json' },
	});

	const result = response.body.results?.[0];
	if (!result) {
		return { success: false, cause: 'ZERO_RESULTS' };
	}

	const parts = [result.name, result.admin1, result.country].filter((i, index, arr) => Boolean(i) && arr.indexOf(i) === index);
	const components = {};
	if (result.name) components.locality = result.name;
	if (result.admin1) components.level1 = result.admin1;
	if (result.admin2) components.level2 = result.admin2;
	components.country = result.country ?? '';

	return {
		success: true,
		formatted: parts.join(', '),
		placeID: `open-meteo-${result.id}`,
		location: { lat: result.latitude, lng: result.longitude },
		components,
	};
};

/** Wie Supibots postToHastebin, aber auf den eigenen Haste-Server (Rueckfall clipzy) */
const postToHastebin = async (text, options = {}) => {
	if (options.title) {
		text = `${options.title}\n\n${text}`;
	}

	try {
		const link = await uploadToOwnHaste(text);
		return { ok: true, statusCode: 200, link, reason: null };
	} catch {
		return { ok: false, statusCode: null, link: null, reason: 'Could not create a Hastebin paste!' };
	}
};

const CHRONO_COMPONENTS = ['year', 'month', 'day', 'weekday', 'hour', 'minute', 'second', 'millisecond', 'meridiem', 'timezoneOffset'];

/** Wie Supibot: erste Zeitangabe im Text, isRelative = nichts davon war ausdruecklich angegeben */
const parseChrono = (string, referenceDate, options) => {
	const chronoData = chronoParse(string, referenceDate, options);
	if (chronoData.length === 0) {
		return null;
	}

	const [chrono] = chronoData;
	const isRelative = CHRONO_COMPONENTS.every((i) => !chrono.start.isCertain(i));
	return {
		date: chrono.start.date(),
		component: chrono.start,
		text: chrono.text,
		isRelative,
	};
};

/** Gespeicherte Form fuer "location" aus einem Suchtreffer, gemeinsam fuer !set location und die Website */
const toUserLocation = (result, hidden) => ({
	formatted: result.formatted,
	placeID: result.placeID,
	components: {
		country: result.components.country ?? '',
		locality: result.components.locality,
		level1: result.components.level1,
		level2: result.components.level2,
	},
	hidden,
	coordinates: result.location,
});

/**
 * Wie Supibots fetchTimeData (Google Timezone API), hier ueber Open-Meteo ohne Key.
 * Open-Meteo liefert nur den aktuellen UTC-Versatz; die Sommerzeit-Umstellung bis zum Zieldatum
 * wird daher nicht beruecksichtigt (dstOffset ist immer 0, rawOffset enthaelt den ganzen Versatz).
 */
const fetchTimeData = async (data) => {
	const response = await got('GenericAPI')({
		url: 'https://api.open-meteo.com/v1/forecast',
		searchParams: {
			latitude: data.coordinates.lat,
			longitude: data.coordinates.lng,
			timezone: 'auto',
			forecast_days: 1,
		},
	});

	const offset = response.body.utc_offset_seconds;
	const body =
		typeof offset === 'number'
			? {
					status: 'OK',
					rawOffset: offset,
					dstOffset: 0,
					timeZoneId: response.body.timezone ?? 'UTC',
					timeZoneName: response.body.timezone_abbreviation ?? 'UTC',
				}
			: { status: 'ZERO_RESULTS', rawOffset: 0, dstOffset: 0, timeZoneId: 'UTC', timeZoneName: 'UTC' };

	return { body };
};

/** Forms a well-formatted timezone offset based on the raw offset numbers. */
const formatTimezoneOffset = (timezone) => {
	const totalOffset = timezone.rawOffset + timezone.dstOffset;
	const symbol = totalOffset >= 0 ? '+' : '-';
	const hours = Math.trunc(Math.abs(totalOffset) / 3600);
	const minutes = bot.Utils.zf((Math.abs(totalOffset) % 3600) / 60, 2);

	return `${symbol}${hours}:${minutes}`;
};

/** Supibots getTwitchGameID: Kategorie per exaktem Namen ueber Helix /games */
const getTwitchGameID = async (name) => {
	const response = await got('Helix')({
		url: 'games',
		searchParams: { name },
	});

	const { data } = response.body;
	if (!response.ok || data.length === 0) {
		return [];
	}

	return data.map((i) => ({
		id: i.id,
		name: i.name,
	}));
};

module.exports = {
	TWITCH_ANTIPING_CHARACTER,
	randomInt,
	fetchGeoLocationData,
	postToHastebin,
	parseChrono,
	toUserLocation,
	fetchTimeData,
	formatTimezoneOffset,
	getTwitchGameID,
};
