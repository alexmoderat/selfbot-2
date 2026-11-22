const { got } = require('../token/got.js');
const stats = require('./channel-stats.js');
const { baseUrl } = require('../token/user-tokens.js');

/**
 * Live- und Rekord-Variablen fuer Custom Commands (alexmoderat, 22.11.2026: "ich moechte aber custom cmd" statt fester
 * Dateien fuer ninou2s !wil, !wilb, !wilbv). Werte werden nur geholt, wenn die Variable im Text vorkommt.
 *
 *   {live_count} {live_list} {live_viewers}            - gerade live (Helix), Liste "@x [2h] // @y [15m]", laengste zuerst
 *   {arg1} {arg2} {args}                               - Woerter nach dem Command (ohne @/#, klein), leer wenn keine
 *   {bot_url}                                          - Basis-Link der Bot-Website
 *   {record_count} {record_date} {record_channels}     - Rekord gleichzeitig live Channels (Cron live-record)
 *   {viewers_record} {viewers_record_date} {viewers_record_channels} - Rekord Gesamt-Viewer, Liste "@x [300] // @y [120]"
 */

/** ninou2, 07.11.2026: "make it like this : @alexmoderat [34h] // @pearsbott [17h] //", "might [be] cleaner" */
const SEPARATOR = ' // ';

/**
 * "@ninou2 [2h]" - volle Stunden, abgerundet; unter einer Stunde Minuten, "[15m]" (ninou2, 07.11.2026: "but if the
 * streamer has been [less] than 1h it show the minutes", "only"); laengste zuerst
 */
const formatLiveList = (streams, now = Date.now()) =>
	[...streams]
		.map((i) => ({ login: i.login, minutes: Math.max(0, Math.floor((now - new Date(i.startedAt).getTime()) / 6e4)) }))
		.sort((a, b) => b.minutes - a.minutes || a.login.localeCompare(b.login))
		.map((i) => `@${i.login} [${i.minutes < 60 ? `${i.minutes}m` : `${Math.floor(i.minutes / 60)}h`}]`);

const fetchLiveStreams = async (ids) => {
	const result = [];
	for (let i = 0; i < ids.length; i += 100) {
		const response = await got('Helix')({
			url: 'streams',
			searchParams: new URLSearchParams([...ids.slice(i, i + 100).map((id) => ['user_id', id]), ['first', '100']]),
		});
		if (!response.ok) {
			throw new Error(`Helix streams: ${response.statusCode}`);
		}
		for (const stream of response.body.data ?? []) {
			result.push({ login: stream.user_login, startedAt: stream.started_at, viewers: stream.viewer_count ?? 0 });
		}
	}

	return result;
};

/** 1st, 2nd, 3rd, 4th ... 11th, 12th, 13th, 21st, 22nd, 23rd ... */
const ordinal = (n) => {
	const tens = n % 100;
	if (tens >= 11 && tens <= 13) {
		return `${n}th`;
	}
	return `${n}${{ 1: 'st', 2: 'nd', 3: 'rd' }[n % 10] ?? 'th'}`;
};

/** "the 18th november 2026 at 16:02 UTC" (ninou2, 19.11.2026: "[Uhrzeit] UTC", "rd/th at the end the day date") */
const formatRecordDate = (date) => {
	const d = new Date(date);
	const month = d.toLocaleDateString('en-US', { month: 'long', timeZone: 'UTC' }).toLowerCase();
	const time = `${String(d.getUTCHours()).padStart(2, '0')}:${String(d.getUTCMinutes()).padStart(2, '0')}`;
	return `the ${ordinal(d.getUTCDate())} ${month} ${d.getUTCFullYear()} at ${time} UTC`;
};

const liveStreams = async () =>
	fetchLiveStreams(
		bot.Channels.getJoinable()
			.map((i) => i.twitchId)
			.filter((i) => Boolean(i)),
	);

/** Variable -> async Wert (bekommt die Argumente des Aufrufs); Rekord ohne Eintrag: 0 / "never" / leer */
const argOf = (args, i) => (args[i] ?? '').replace(/^[@#]+/, '');
const VARIABLES = {
	arg1: async (args) => argOf(args, 0).toLowerCase(),
	arg2: async (args) => argOf(args, 1).toLowerCase(),
	args: async (args) => args.join(' '),
	bot_url: async () => baseUrl(),
	live_count: async () => String((await liveStreams()).length),
	live_list: async () => formatLiveList(await liveStreams()).join(SEPARATOR),
	live_viewers: async () => String((await liveStreams()).reduce((sum, i) => sum + (i.viewers ?? 0), 0)),
	record_count: async () => String((await stats.getRecord('live_channels'))?.Value ?? 0),
	record_date: async () => ((await stats.getRecord('live_channels'))?.Achieved ? formatRecordDate((await stats.getRecord('live_channels')).Achieved) : 'never'),
	record_channels: async () =>
		[...((await stats.getRecord('live_channels'))?.Channels ?? [])]
			.sort((a, b) => a.localeCompare(b))
			.map((i) => `@${i}`)
			.join(' '),
	viewers_record: async () => String((await stats.getRecord('live_viewers'))?.Value ?? 0),
	viewers_record_date: async () => ((await stats.getRecord('live_viewers'))?.Achieved ? formatRecordDate((await stats.getRecord('live_viewers')).Achieved) : 'never'),
	viewers_record_channels: async () => ((await stats.getRecord('live_viewers'))?.Channels ?? []).map((i) => `@${i.login} [${i.viewers}]`).join(SEPARATOR),
};

/** Ersetzt die Variablen im Text; jede Variable einmal geholt (Helix/DB), auch wenn sie mehrfach vorkommt */
const resolveVariables = async (text, args = []) => {
	const cache = new Map();
	const names = [...new Set([...text.matchAll(/\{(\w+)\}/g)].map((i) => i[1].toLowerCase()))].filter((i) => i in VARIABLES);
	for (const name of names) {
		cache.set(name, await VARIABLES[name](args));
	}
	return text.replaceAll(/\{(\w+)\}/g, (all, name) => cache.get(name.toLowerCase()) ?? all);
};

module.exports = { SEPARATOR, formatLiveList, fetchLiveStreams, ordinal, formatRecordDate, resolveVariables, VARIABLES };
