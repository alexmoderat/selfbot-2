const z = require('zod');
const SupiDate = require('./date.js');

const countryTimezones = require('./country-timezones.json');
const rawTimezones = require('./timezones.json');
const { typeRegexGroups } = require('./ts-helpers.js');

// Zeitzonen-Erkennung aus Supibots commands/time, gemeinsam fuer !time und !uts
const timezonesSchema = z.array(
	z.object({
		abbreviation: z.string(),
		name: z.string(),
		offset: z.number(),
		description: z.string().nullable(),
	}),
);
const timezones = timezonesSchema.parse(rawTimezones);

const detectTimezone = (...args) => {
	const query = args.join(' ');
	const utcRegex = /(?<base>UTC|GMT)(?<sign>[+-])(?<hours>\d{1,2})(:?(?<minutes>\d{1,2}))?/i;
	const match = query.match(utcRegex);

	if (match) {
		const groups = typeRegexGroups(match);
		const { sign, hours, minutes } = groups;

		const multiplier = sign === '-' ? -1 : 1;
		const numMinutes = minutes ? Number(minutes) : 0;
		const offset = multiplier * (Number(hours) * 60 + numMinutes);

		if (!Number.isFinite(offset)) {
			return {
				success: false,
				reply: `Malformed timezone offset provided!`,
			};
		} else if (Math.abs(offset) > 14 * 60) {
			// UTC[+/-]14 is the maximum offset
			return {
				success: false,
				reply: `Maximum timezone offset exceeded!`,
			};
		}

		return {
			date: new SupiDate().setTimezoneOffset(offset).format('H:i (Y-m-d)'),
			offset: `${sign}${hours}${minutes ?? ''}`,
			abbr: null,
			name: null,
		};
	}

	// Anders als bei Supibot ohne Gross-/Kleinschreibung (ninou2, 03.11.2026: "!time utc")
	const timezoneData = timezones.find((i) => i.abbreviation.toLowerCase() === query.toLowerCase());
	if (!timezoneData) {
		return null;
	}

	const extraOffset = (Math.trunc(timezoneData.offset) - timezoneData.offset) * 60;
	let offset = `${`00${String(Math.trunc(timezoneData.offset))}`.slice(-2)}:${`00${extraOffset}`.slice(-2)}`;
	if (offset[0] !== '-') {
		offset = `+${offset}`;
	}

	const date = new SupiDate().setTimezoneOffset(timezoneData.offset * 60).format('H:i (Y-m-d)');
	return {
		date,
		offset,
		abbr: timezoneData.abbreviation,
		name: timezoneData.name,
	};
};

// ninou2, 03.11.2026: "make that the most famous timezone be on top [of] the list"
const COMMON_ZONES = [
	'UTC',
	'GMT',
	'BST',
	'WET',
	'CET',
	'CEST',
	'EET',
	'EEST',
	'MSK',
	'IST',
	'PKT',
	'HKT',
	'SGT',
	'JST',
	'KST',
	'AEST',
	'AEDT',
	'NZST',
	'NZDT',
	'AST',
	'EST',
	'EDT',
	'CST',
	'CDT',
	'MST',
	'MDT',
	'PST',
	'PDT',
	'AKST',
	'HST',
	'BRT',
	'ART',
];
const zoneRank = (abbreviation) => {
	const index = COMMON_ZONES.indexOf(abbreviation);
	return index === -1 ? COMMON_ZONES.length : index;
};

/** "CET: Central European Time (UTC+1)" fuer !timelist: die gaengigen zuerst, danach nach Abkuerzung */
const formatTimezoneList = () =>
	timezones
		.toSorted((a, b) => zoneRank(a.abbreviation) - zoneRank(b.abbreviation) || a.abbreviation.localeCompare(b.abbreviation))
		.map((i) => {
			const hours = Math.trunc(Math.abs(i.offset));
			const minutes = Math.round((Math.abs(i.offset) - hours) * 60);
			const offset = `${i.offset < 0 ? '-' : '+'}${hours}${minutes ? `:${String(minutes).padStart(2, '0')}` : ''}`;
			return `${i.abbreviation}: ${i.name} (UTC${offset})`;
		});

/**
 * Laender direkt aus der IANA-Tabelle (zone.tab) statt ueber die unscharfe Ortssuche: dort landete "UK" bei UTC+8 und
 * "pt" bei UTC-6 (ninou2, 03.11.2026: "UK +8h"). Versaetze kommen aus Intl und folgen damit der Sommerzeit.
 */
const COUNTRY_ALIASES = { UK: 'GB', USA: 'US', UAE: 'AE', ENGLAND: 'GB', BRITAIN: 'GB', 'GREAT BRITAIN': 'GB', AMERICA: 'US' };
const countryZones = countryTimezones;
const countryNames = new Intl.DisplayNames('en', { type: 'region' });
const countryName = (code) => countryNames.of(code) ?? code;

const zoneOffsetMinutes = (zone, now) => {
	const label =
		new Intl.DateTimeFormat('en-US', { timeZone: zone, timeZoneName: 'longOffset' }).formatToParts(now).find((i) => i.type === 'timeZoneName')?.value ??
		'GMT';
	const match = label.match(/GMT([+-])(\d{2}):(\d{2})/);
	return match ? (match[1] === '-' ? -1 : 1) * (Number(match[2]) * 60 + Number(match[3])) : 0;
};

const formatOffset = (minutes) => {
	const abs = Math.abs(minutes);
	return `UTC${minutes < 0 ? '-' : '+'}${Math.trunc(abs / 60)}:${String(abs % 60).padStart(2, '0')}`;
};

/** Verschiedene Versaetze eines Landes, aufsteigend: ein Land mit mehreren Zeitzonen liefert mehrere Eintraege */
const countryOffsets = (code, now) => [...new Set(countryZones[code].map((i) => zoneOffsetMinutes(i, now)))].toSorted((a, b) => a - b);

const findCountryCode = (query) => {
	const upper = query.trim().toUpperCase();
	if (countryZones[upper]) {
		return upper;
	} else if (COUNTRY_ALIASES[upper]) {
		return COUNTRY_ALIASES[upper];
	}

	return Object.keys(countryZones).find((i) => countryName(i).toUpperCase() === upper) ?? null;
};

const detectCountryTime = (query, now = new Date()) => {
	const code = findCountryCode(query);
	if (!code) {
		return null;
	}

	const times = countryOffsets(code, now).map((minutes) => ({
		offset: formatOffset(minutes),
		date: new SupiDate(now.getTime()).setTimezoneOffset(minutes).format('H:i (Y-m-d)'),
	}));
	return { name: countryName(code), times };
};

/** "Portugal (PT): UTC-1:00, UTC+0:00", nach Name sortiert, fuer !timelist */
const formatCountryList = (now = new Date()) =>
	Object.keys(countryZones)
		.map((code) => `${countryName(code)} (${code}): ${countryOffsets(code, now).map(formatOffset).join(', ')}`)
		.toSorted((a, b) => a.localeCompare(b));

module.exports = { timezones, detectTimezone, formatTimezoneList, detectCountryTime, formatCountryList };
