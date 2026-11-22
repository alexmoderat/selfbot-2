const { got } = require('../token/got.js');
const { fetchTwitchUser } = require('../util/twitch/twitch-utils.js');
const { authLink, forceRefreshToken, getToken, getValidToken, helixAsUser } = require('../token/user-tokens.js');

/**
 * Wie lange ein User einem Channel folgt, aus sb-v2. channels/followers mit user_id braucht nur Mod-Rechte des Bots
 * im Ziel-Channel (moderator:read:followers) - der Normalfall. Fuer den Bot selbst geht channels/followed mit dem
 * eigenen Token ueberall. Sonst wie in sb-v2 der Token des Users aus /auth/<user> (Block 9), mit Auth-Link, wenn er fehlt.
 */

// Echte Kalenderdifferenz statt 30-Tage-Monaten (ninou2, 18.09.2026: "who got the right data" - StreamElements-Vergleich)
const formatFollowDuration = (from, to) => {
	let years = to.getUTCFullYear() - from.getUTCFullYear();
	let months = to.getUTCMonth() - from.getUTCMonth();
	let days = to.getUTCDate() - from.getUTCDate();
	let hours = to.getUTCHours() - from.getUTCHours();

	if (hours < 0) {
		hours += 24;
		days -= 1;
	}
	if (days < 0) {
		days += new Date(Date.UTC(to.getUTCFullYear(), to.getUTCMonth(), 0)).getUTCDate();
		months -= 1;
	}
	if (months < 0) {
		months += 12;
		years -= 1;
	}

	// ninou2, 18.09.2026: "NO hours tho" - alle Einheiten wie StreamElements, keine Kappung auf zwei
	const parts = [];
	if (years > 0) parts.push(`${years} year${years > 1 ? 's' : ''}`);
	if (months > 0) parts.push(`${months} month${months > 1 ? 's' : ''}`);
	if (days > 0) parts.push(`${days} day${days > 1 ? 's' : ''}`);
	if (hours > 0) parts.push(`${hours} hour${hours > 1 ? 's' : ''}`);

	return parts.length > 0 ? parts.join(', ') : 'less than an hour';
};

const formatFollowDate = (date) =>
	date.toLocaleString('en-GB', {
		day: '2-digit',
		month: '2-digit',
		year: 'numeric',
		hour: '2-digit',
		minute: '2-digit',
		hour12: false,
		timeZone: 'UTC',
	});

const command = {
	name: 'followage',
	aliases: ['fa'],
	cooldown: { user: 3 },
	access: { channel: 2 },
	description: 'How long a user has followed a channel. No arguments: you in this channel.',
	usage: 'followage [user] [channel]',
	execute: async ({ client, message: msg }) => {
		const [userArg, channelArg] = msg.args;
		const display = msg.displayName;
		const targetUser = (userArg ?? msg.sender.name).toLowerCase().replace('@', '');
		const targetChannel = (channelArg ?? msg.channelData?.name ?? '').toLowerCase().replace('#', '');

		const [broadcaster, user] = await Promise.all([targetChannel ? fetchTwitchUser(targetChannel) : null, fetchTwitchUser(targetUser)]);
		if (!broadcaster) {
			return `@${display}, channel "${targetChannel}" not found.`;
		}
		if (!user) {
			return `@${display}, user "${targetUser}" not found.`;
		}

		let response = await got('Helix')({
			url: 'channels/followers',
			searchParams: { broadcaster_id: broadcaster.id, user_id: user.id },
		});

		if ((response.statusCode === 401 || response.statusCode === 403) && user.id === bot.Twitch.selfId) {
			response = await got('Helix')({
				url: 'channels/followed',
				searchParams: { user_id: user.id, broadcaster_id: broadcaster.id },
			});
		}

		if (response.statusCode === 401 || response.statusCode === 403) {
			// Bot ist dort kein Mod - ueber den eigenen Token des Users (channels/followed)
			const reauth = { text: `@${display}, token expired. Re-authorize: ${authLink(targetUser)}` };
			let token = await getValidToken(targetUser);
			if (!token) {
				return (await getToken(targetUser)) ? reauth : { text: `@${display}, ${targetUser} hasn't authorized yet: ${authLink(targetUser)}` };
			}

			const followed = { url: 'channels/followed', searchParams: { user_id: user.id, broadcaster_id: broadcaster.id } };
			response = await helixAsUser(token, followed);
			if (response.statusCode === 401) {
				token = await forceRefreshToken(targetUser);
				if (!token) {
					return reauth;
				}
				response = await helixAsUser(token, followed);
				if (response.statusCode === 401) {
					return reauth;
				}
			}
		}

		if (!response.ok) {
			throw new Error(`Helix followers: ${response.statusCode}`);
		}

		const entry = response.body.data[0];
		if (!entry) {
			return `@${display}, ${user.display_name} does not follow ${broadcaster.display_name}.`;
		}

		const followedDate = new Date(entry.followed_at);
		return `@${display}, ${user.display_name} has followed ${broadcaster.display_name} for ${formatFollowDuration(followedDate, new Date())}. (since ${formatFollowDate(followedDate)} UTC)`;
	},
};

module.exports = { command };

Object.assign(module.exports, { formatFollowDuration, formatFollowDate });
