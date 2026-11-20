const { defineCron } = require('../timers.js');
const { fetchWindows, activeWindows, BADGES_URL } = require('../../../misc/streamdatabase.js');
const { wasAnnounced, markAnnounced, recordRecent } = require('../../../misc/badge-history.js');
const { enabledChannels } = require('./badge-watch.js');
const { cleanTimes } = require('../../../util/tweet-notify.js');

/**
 * Meldet, wenn ein Zeitfenster fuer ein globales Badge beginnt oder neu eingetragen wird (alexmoderat, 14.11.2026, nachdem der
 * Tweet-Weg wegen supinics 503 ausfiel; ninou2, 13.11.2026: "once the clock hit 23:00 a message post in the chat that badge is
 * live to claim"). Quelle sind die Aktionen von StreamDatabase mit Start- und Endzeit, kein Twitter. Gleicher Schalter und
 * Zusatztext wie badge-watch. Der erste Lauf merkt sich nur, was gerade aktiv ist.
 */
const STATE_KEY = 'event-watch:active';
const STATE_TTL = 30 * 864e5;
const MAX_SEPARATE = 3; // mehr auf einmal = eine Sammelmeldung

const monthDay = (ms) => new Date(ms).toLocaleString('en-US', { month: 'long', day: 'numeric', year: 'numeric', timeZone: 'UTC' });
const hhmm = (ms) => new Date(ms).toISOString().slice(11, 16);

// Gleiche Form wie der StreamDatabase-Tweet ("The event ends November 14, 2026 at 15:59. (UTC)"), damit !bi dahinter [AVAILABLE!]/[ENDED!] setzt
const formatWindow = (window) =>
	`Twitch global badge now available: ${window.title}${window.how ? ` [${window.how}]` : ''}${window.event && window.event.toLowerCase() !== window.title.toLowerCase() ? ` (${window.event})` : ''} The event ends ${monthDay(window.endMs)} at ${hhmm(window.endMs)}. (UTC)`;

const withCustom = (text, custom) => (custom ? `${text} ${custom}` : text);

const TWEET_ACCOUNT = 'streamdatabase';

/**
 * Abonnenten von Tweet Notify fuer @StreamDatabase, je Channel/Text/Anzahl gruppiert. Diese Meldung ersetzt den Tweet, also gilt
 * ihr eigener Text und ihre Anzahl (ninou2, 14.11.2026: "that is not my custom message, and i have x2 as times to post").
 */
const tweetSubscribers = async () => {
	const rows = await bot.DB.TweetNotify.find({ account: TWEET_ACCOUNT }).lean();
	const groups = new Map();
	for (const row of rows) {
		const user = await bot.Users.get(row.userAlias);
		const channel = bot.Channels.get(row.channel);
		if (!user || !channel || channel.mode === 'Inactive') {
			continue;
		}
		const times = cleanTimes(row.times);
		const key = `${row.channel}\u0000${row.message ?? ''}\u0000${times}`;
		const group = groups.get(key) ?? { channel, message: row.message ?? '', times, users: [] };
		group.users.push(user.name);
		groups.set(key, group);
	}

	return [...groups.values()];
};

const formatSubscriberAlert = (users, text, custom) => withCustom(`${users.map((i) => `@${i}`).join(' ')} — @StreamDatabase: ${text}`, custom);

const runEventWatch = async () => {
	const windows = await fetchWindows();
	const active = activeWindows(windows);
	const stored = await bot.Redis.getJSON(STATE_KEY).catch(() => null);
	const before = Array.isArray(stored) ? new Set(stored) : null;
	await bot.Redis.setJSON(STATE_KEY, active.map((i) => i.key), STATE_TTL);
	if (!before) {
		console.log(`[event-watch] Erstlauf, ${active.length} aktive Fenster gemerkt`);
		return 0;
	}

	// Pro Badge und Tag nur eine Meldung, egal ob Tweet oder Aktionen sie zuerst melden (Marker teilt sich badge-watch)
	const today = new Date().toISOString().slice(0, 10);
	const fresh = [];
	for (const window of active.filter((i) => !before.has(i.key))) {
		const marker = `avail:badge:${window.title.toLowerCase()}:${today}`;
		if (await wasAnnounced(marker).catch(() => false)) {
			console.log(`[event-watch] ${window.title}: schon gemeldet`);
			continue;
		}
		await markAnnounced(marker).catch(() => {});
		fresh.push(window);
	}
	if (fresh.length === 0) {
		return 0;
	}

	await recordRecent(
		'tweet',
		fresh.map((i) => ({ title: formatWindow(i), link: BADGES_URL })),
	).catch((e) => console.warn(`[event-watch] Verlauf: ${e?.message ?? e}`));

	const targets = await enabledChannels();
	const texts =
		fresh.length <= MAX_SEPARATE
			? fresh.map(formatWindow)
			: [`${fresh.length} global Twitch badges now available: ${fresh.map((i) => i.title).join(', ')} (${BADGES_URL})`];
	console.log(`[event-watch] ${fresh.map((i) => i.title).join(', ')} -> ${targets.length} Channel(s)`);
	// Tweet-Notify-Abonnenten (eigener Text, Anzahl) bekommen die Meldung wie einen Tweet; in deren Channels entfaellt der Badge-Alert-Text
	const subscribers = await tweetSubscribers().catch((e) => {
		console.warn(`[event-watch] Tweet-Notify-Abonnenten: ${e?.message ?? e}`);
		return [];
	});
	const handled = new Set(subscribers.map((i) => i.channel.id));
	for (const { channel, message, times, users } of subscribers) {
		for (let n = 0; n < times; n++) {
			for (const text of texts) {
				await bot.Channels.send(channel, formatSubscriberAlert(users, text, message)).catch(() => {});
			}
		}
	}
	for (const { channel, message } of targets) {
		if (handled.has(channel.id)) {
			continue;
		}
		for (const text of texts) {
			await bot.Channels.send(channel, withCustom(text, message)).catch(() => {});
		}
	}

	return fresh.length;
};

module.exports = defineCron({
	name: 'event-watch',
	// Jede Minute kurz nach :00, damit die Meldung zur vollen Minute des Fensterbeginns kommt (ninou2, 15.11.2026: "very late", vorher alle 3 min bei :45)
	expression: '1 * * * * *',
	description: 'Announces when a time window for a global Twitch badge starts (data from streamdatabase.com events), same toggle as the badge alerts.',
	code: async function eventWatch() {
		await runEventWatch().catch((e) => console.warn(`[event-watch] ${e?.message ?? e}`));
	},
});

Object.assign(module.exports, { formatWindow, runEventWatch, tweetSubscribers, formatSubscriberAlert });
