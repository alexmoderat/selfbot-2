const { getRecent } = require('../util/badge-history.js');
const { fmtLengthShort } = require('../util/streamer-streak.js');
const { eventStatus } = require('../token/streamdatabase.js');

/**
 * Die zuletzt gemeldeten globalen Twitch-Badges und -Emotes noch einmal ausgeben (ninou2, 13.11.2026: "command should be
 * !bi !badgeinfo", "if you only type !bi the bot only post the latest (only 1) info", "!bi 3 -> the latest 3 infos he got from
 * the database"). Badges, Emotes und Verfuegbarkeits-Tweets (ninou2, 13.11.2026: "!bi should warn us ... about the latest info which is [Tweet-Link]") gemeinsam, neueste zuerst; Daten aus dem Verlauf des badge-watch-Crons.
 */
const MAX_COUNT = 5;

const parseCount = (args) => {
	const n = Number.parseInt(args[0] ?? '1', 10);
	return Number.isNaN(n) ? 1 : Math.min(MAX_COUNT, Math.max(1, n));
};

/** Beide Verlaeufe zusammenfuehren, neueste zuerst (bei gleicher Zeit bleibt die gespeicherte Reihenfolge) */
const mergeRecent = (badges, emotes, count, tweets = []) =>
	[...badges.map((i) => ({ ...i, kind: 'badge' })), ...emotes.map((i) => ({ ...i, kind: 'emote' })), ...tweets.map((i) => ({ ...i, kind: 'tweet' }))]
		.map((entry, index) => ({ entry, index }))
		.sort((a, b) => Date.parse(b.entry.at) - Date.parse(a.entry.at) || a.index - b.index)
		.slice(0, count)
		.map((i) => i.entry);

const agoOf = (entry) => `${fmtLengthShort(Date.now() - Date.parse(entry.at))} ago`;

const TWEET_TEXT_LIMIT = 200;
// [ENDED!] / [AVAILABLE!] hinter dem Tweet-Text, je nach Ende des Zeitfensters (ninou2, 13.11.2026)
const describeTweet = (entry) => {
	const status = eventStatus(entry.title);
	const text = entry.title.length > TWEET_TEXT_LIMIT ? `${entry.title.slice(0, TWEET_TEXT_LIMIT - 1)}…` : entry.title;
	return `${text}${status ? ` ${status}` : ''} ${entry.link} (${agoOf(entry)})`;
};

const describeFull = (entry) => {
	if (entry.kind === 'tweet') {
		return describeTweet(entry);
	}

	const detail = [entry.how, entry.until ? `until ${entry.until}` : ''].filter(Boolean).join(', ');
	const text = entry.kind === 'badge' && entry.description ? `${entry.title} - ${entry.description}` : entry.title;
	return `${text}${detail ? ` [${detail}]` : ''} (${agoOf(entry)})`;
};

const formatRecent = (entries) =>
	entries.length === 1
		? `Last global Twitch ${entries[0].kind === 'tweet' ? 'info' : entries[0].kind}: ${describeFull(entries[0])}`
		: `Last ${entries.length} global Twitch infos: ${entries.map((i) => (i.kind === 'tweet' ? `tweet${eventStatus(i.title) ? ` ${eventStatus(i.title)}` : ''} ${i.link} (${agoOf(i)})` : `${i.kind} ${i.title} (${agoOf(i)})`)).join(', ')}`;

module.exports = {
	name: 'badgeinfo',
	aliases: ['bi', 'badgein'],
	cooldown: 5000,
	description: `Posts the last 1-${MAX_COUNT} global Twitch badges and emotes the bot noticed (data from streamdatabase.com). Without a number only the latest one.`,
	usage: `badgeinfo [1-${MAX_COUNT}]`,
	execute: async (client, msg) => {
		const count = parseCount(msg.args);
		const [badges, emotes, tweets] = await Promise.all([getRecent('badge', count), getRecent('emote', count), getRecent('tweet', count)]);
		const entries = mergeRecent(badges, emotes, count, tweets);
		if (entries.length === 0) {
			return { text: `@${msg.displayName}, no global Twitch badges or emotes recorded yet.` };
		}

		return { text: `@${msg.displayName}, ${formatRecent(entries)}` };
	},
};
Object.assign(module.exports, { parseCount, mergeRecent, formatRecent });
