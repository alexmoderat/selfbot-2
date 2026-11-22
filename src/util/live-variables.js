const { got } = require('../token/got.js');
const stats = require('./channel-stats.js');
const { baseUrl } = require('../token/user-tokens.js');
const streamInfoModule = require('./stream-info.js');
const lastLiveModule = require('./lastlive-data.js');
const userDataModule = require('./user-data.js');
const viewerStreakModule = require('./viewerstreak-data.js');
const stalkModule = require('./stalk-data.js');
const topModule = require('./top-data.js');

/**
 * Live- und Rekord-Variablen fuer Custom Commands (alexmoderat, 22.11.2026: "ich moechte aber custom cmd" statt fester
 * Dateien fuer ninou2s !wil, !wilb, !wilbv). Werte werden nur geholt, wenn die Variable im Text vorkommt.
 *
 *   {live_count} {live_list} {live_viewers}            - gerade live (Helix), Liste "@x [2h] // @y [15m]", laengste zuerst
 *   {arg1} {arg2} {args}                               - Woerter nach dem Command (ohne @/#, klein), leer wenn keine
 *   {si_kind} {si_target} {si_name} {si_viewers} {si_game} {si_uptime} {si_bitrate} {si_fps} {si_resolution} {si_clips}
 *   {si_title} {si_thumb} {si_offline} {si_last_game} {si_last_title} {si_error} - Stream-Infos von {arg1} oder dem Channel;
 *                                                      si_kind: live | offline | notfound | error
 *   {ll_kind} {ll_channel} {ll_own} {ll_start} {ll_length} {ll_prev} {ll_year} {ll_when} {ll_ago} {ll_date} {ll_count}
 *   {ll_sessions} {ll_total} {ll_dayword}              - zuletzt live von {arg1} oder dem Channel (lastlive-data.js);
 *                                                      ll_kind: notfound | live | none | untracked | multi | single
 *   {u_kind} {u_login} {u_name} {u_display} {u_id} {u_color} {u_roles} {u_roles_c} {u_followers} {u_bio} {u_bio_c} {u_created}
 *   {u_last_live_ago} {u_tail} {u_tail_c} {u_ban_type} {u_available} {u_restricted} - Account-Infos von {arg1} (user-data.js);
 *                                                      u_kind: usage | notfound | banned | ok
 *   {vs_kind} {vs_hint} {vs_login} {vs_channel} {vs_value} {vs_seen} {vs_best} - Watch-Streak von {arg1} (viewerstreak-data.js);
 *                                                      vs_kind: nochannel | top | notfound | none | ok
 *   {s_kind} {s_emote} {s_first} {s_who} {s_ago} {s_channel} {s_text} - zuletzt gesehen: {arg1} (stalk-data.js);
 *                                                      s_kind: usage | nouser | self | bot | never | nochannel | banned | ok
 *   {top_games}                                        - Top-10-Kategorien auf Twitch (top-data.js)
 *   {ts_kind} {ts_list}                                - Top-10-Streams, optional einer Kategorie ({args}); ts_kind: nogame | empty | ok
 *   {bot_url}                                          - Basis-Link der Bot-Website
 *   {record_count} {record_date} {record_channels}     - Rekord gleichzeitig live Channels (Cron live-record)
 *   {viewers_record} {viewers_record_date} {viewers_record_channels} - Rekord Gesamt-Viewer, Liste "@x [300] // @y [120]"
 *
 * Bedingungen: {if name}...{else}...{/if}, {if name=wert}, {if name!=wert} (wahr = nicht leer und nicht 0); verschachtelbar.
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
/** Stream-Infos des Ziels (arg1 oder Channel), einmal pro Aufruf geholt */
const streamInfo = async (args, ctx) => {
	if (!ctx.memo.has('si')) {
		const target = argOf(args, 0).toLowerCase() || ctx.channel || '';
		let data;
		try {
			const info = await streamInfoModule.getStreamInfo(target);
			data = info ? (info.live ? { kind: 'live', info } : { kind: 'offline', info }) : { kind: 'notfound' };
		} catch (e) {
			data = { kind: 'error', error: e instanceof Error ? e.message : String(e) };
		}
		ctx.memo.set('si', { target, ...data });
	}

	return ctx.memo.get('si');
};
const siField = (read) => async (args, ctx) => {
	const data = await streamInfo(args, ctx);
	return String(read(data, data.info ?? {}) ?? '');
};

/** Zuletzt-live-Daten des Ziels (arg1 oder Channel), einmal pro Aufruf berechnet */
const lastLive = async (args, ctx) => {
	if (!ctx.memo.has('ll')) {
		ctx.memo.set('ll', await lastLiveModule.getLastLive(argOf(args, 0).toLowerCase() || ctx.channel || '', ctx.channel));
	}

	return ctx.memo.get('ll');
};
const llField = (key) => async (args, ctx) => String((await lastLive(args, ctx))[key] ?? '');

/** Account-Infos des Users aus arg1, einmal pro Aufruf geholt */
const userData = async (args, ctx) => {
	if (!ctx.memo.has('u')) {
		ctx.memo.set('u', await userDataModule.getUserData(argOf(args, 0).toLowerCase().trim()));
	}

	return ctx.memo.get('u');
};
const uField = (key) => async (args, ctx) => String((await userData(args, ctx))[key] ?? '');

/** Watch-Streak des Users aus arg1 (sonst der Sender) im Channel */
const viewerStreak = async (args, ctx) => {
	if (!ctx.memo.has('vs')) {
		ctx.memo.set('vs', await viewerStreakModule.getViewerStreak({ userRaw: args[0], channelName: ctx.channel, channelId: ctx.twitchId, senderName: ctx.sender?.name }));
	}

	return ctx.memo.get('vs');
};
const vsField = (key) => async (args, ctx) => String((await viewerStreak(args, ctx))[key] ?? '');

/** Zuletzt gesehen: arg1 */
const stalk = async (args, ctx) => {
	if (!ctx.memo.has('s')) {
		ctx.memo.set('s', await stalkModule.getStalk({ userRaw: argOf(args, 0), msg: ctx.msg, hasChannel: Boolean(ctx.channel) }));
	}

	return ctx.memo.get('s');
};
const sField = (key) => async (args, ctx) => String((await stalk(args, ctx))[key] ?? '');

/** Top-10-Streams, Kategorie aus allen Argumenten */
const topStreams = async (args, ctx) => {
	if (!ctx.memo.has('ts')) {
		ctx.memo.set('ts', await topModule.getTopStreams(args.join(' ').trim()));
	}

	return ctx.memo.get('ts');
};

const argOf = (args, i) => (args[i] ?? '').replace(/^[@#]+/, '');
const VARIABLES = {
	...Object.fromEntries(['kind', 'channel', 'own', 'start', 'length', 'prev', 'year', 'when', 'ago', 'date', 'count', 'sessions', 'total', 'dayword'].map((key) => [`ll_${key}`, llField(key)])),
	...Object.fromEntries(
		Object.entries({
			kind: 'kind',
			login: 'login',
			name: 'name',
			display: 'display',
			id: 'id',
			color: 'color',
			roles: 'roles',
			roles_c: 'rolesCompact',
			followers: 'followers',
			bio: 'bio',
			bio_c: 'bioCompact',
			created: 'created',
			last_live_ago: 'lastLiveAgo',
			tail: 'tail',
			tail_c: 'tailCompact',
			ban_type: 'banType',
			available: 'available',
			restricted: 'restricted',
		}).map(([name, key]) => [`u_${name}`, uField(key)]),
	),
	...Object.fromEntries(['kind', 'hint', 'login', 'channel', 'value', 'seen', 'best'].map((key) => [`vs_${key}`, vsField(key)])),
	...Object.fromEntries(['kind', 'emote', 'first', 'who', 'ago', 'channel', 'text'].map((key) => [`s_${key}`, sField(key)])),
	top_games: async () => topModule.getTopGames(),
	ts_kind: async (args, ctx) => (await topStreams(args, ctx)).kind,
	ts_list: async (args, ctx) => (await topStreams(args, ctx)).list ?? '',
	si_kind: siField((d) => d.kind),
	si_target: siField((d) => d.target),
	si_error: siField((d) => d.error),
	si_name: siField((d, i) => i.displayName),
	si_viewers: siField((d, i) => (d.kind === 'live' ? i.viewers : '')),
	si_game: siField((d, i) => (d.kind === 'live' ? i.gameName : '')),
	si_uptime: siField((d, i) => (d.kind === 'live' ? i.uptime : '')),
	si_bitrate: siField((d, i) => i.hls?.bitrate),
	si_fps: siField((d, i) => i.hls?.fps),
	si_resolution: siField((d, i) => i.hls?.resolution),
	si_clips: siField((d, i) => i.clipCount),
	si_title: siField((d, i) => (d.kind === 'live' ? i.title : '')),
	si_thumb: siField((d, i) => (d.kind === 'live' ? i.thumb : '')),
	si_offline: siField((d, i) => (d.kind === 'offline' ? i.offlineSince : '')),
	si_last_game: siField((d, i) => (d.kind === 'offline' ? i.lastGame : '')),
	si_last_title: siField((d, i) => (d.kind === 'offline' ? i.lastTitle : '')),
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

const IF_BLOCK = /\{if (\w+)(?:(!?=)([^}]*))?\}((?:(?!\{if )[\s\S])*?)(?:\{else\}((?:(?!\{if )[\s\S])*?))?\{\/if\}/;

/**
 * Ersetzt Bedingungen und Variablen; jede Variable einmal geholt (Helix/DB), auch wenn sie mehrfach vorkommt. Erst die
 * Bedingungen, dann die Werte in einem Durchgang - ein Wert (z. B. ein Streamtitel mit "{if") wird nie als Vorlage gelesen.
 * ctx: { channel } fuer das Standardziel
 */
const resolveVariables = async (text, args = [], context = {}) => {
	const ctx = { channel: context.channel ?? '', twitchId: context.twitchId, sender: context.sender, msg: context.msg, memo: new Map() };
	const names = [...new Set([...text.matchAll(/\{(?:if )?(\w+)[}=!]/g)].map((i) => i[1].toLowerCase()))].filter((i) => i in VARIABLES);
	const values = new Map();
	for (const name of names) {
		values.set(name, await VARIABLES[name](args, ctx));
	}

	let out = text;
	for (let guard = 0; guard < 200 && IF_BLOCK.test(out); guard++) {
		out = out.replace(IF_BLOCK, (all, name, op, expected, body, otherwise = '') => {
			const value = values.get(name.toLowerCase());
			const truthy = op ? (value ?? '') === expected : Boolean(value) && value !== '0';
			return (op === '!=' ? !truthy : truthy) ? body : otherwise;
		});
	}

	return out.replaceAll(/\{(\w+)\}/g, (all, name) => values.get(name.toLowerCase()) ?? all);
};

module.exports = { SEPARATOR, formatLiveList, fetchLiveStreams, ordinal, formatRecordDate, resolveVariables, VARIABLES };
