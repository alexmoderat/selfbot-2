const { getRecent } = require('../misc/badge-history.js');
const { fmtLengthShort } = require('../misc/streamer-streak.js');

/**
 * Die zuletzt gemeldeten globalen Twitch-Badges bzw. -Emotes noch einmal ausgeben, 1 bis 5 (ninou2, 13.11.2026: "a way to
 * trigger the bot to post the last 1 info he got from database and u can choose up to 5"). Daten aus dem Verlauf des
 * badge-watch-Crons.
 */
const MAX_COUNT = 5;

const parseCount = (args) => {
	const n = Number.parseInt(args[0] ?? '1', 10);
	return Number.isNaN(n) ? 1 : Math.min(MAX_COUNT, Math.max(1, n));
};

const describe = (entry, kind, withDetails) => {
	const detail = [entry.how, entry.until ? `until ${entry.until}` : ''].filter(Boolean).join(', ');
	const ago = `${fmtLengthShort(Date.now() - Date.parse(entry.at))} ago`;
	const text = kind === 'badge' && withDetails && entry.description ? `${entry.title} - ${entry.description}` : entry.title;
	return `${text}${detail ? ` [${detail}]` : ''} (${ago})`;
};

const formatRecent = (kind, entries) =>
	entries.length === 1
		? `Last global Twitch ${kind}: ${describe(entries[0], kind, true)}`
		: `Last ${entries.length} global Twitch ${kind}s: ${entries.map((i) => describe(i, kind, false)).join(', ')}`;

const makeCommand = (kind, name, aliases) => ({
	name,
	aliases,
	cooldown: 5000,
	description: `Posts the last 1-${MAX_COUNT} global Twitch ${kind}s the bot noticed (data from streamdatabase.com).`,
	usage: `${name} [1-${MAX_COUNT}]`,
	execute: async (client, msg) => {
		const entries = await getRecent(kind, parseCount(msg.args));
		if (entries.length === 0) {
			return { text: `@${msg.displayName}, no global Twitch ${kind}s recorded yet.` };
		}

		return { text: `@${msg.displayName}, ${formatRecent(kind, entries)}` };
	},
});

module.exports = makeCommand('badge', 'lastbadge', ['lb', 'lastbadges']);
Object.assign(module.exports, { parseCount, formatRecent, makeCommand });
