const { got } = require('../../token/got.js');
const { SupiError } = require('../../misc/error.js');
const { getAppToken, getUserToken, invalidateUserToken, invalidateAppToken, storeBotRefreshToken } = require('../../token/helix.js');

// Helix-Abfragen, die viele Commands brauchen (bisher platforms/twitch-utils.ts, ohne den EventSub-Teil)

/** Twitch-User per Login (oder per ID mit byId) - null, wenn es ihn nicht gibt */
const fetchTwitchUser = async (identifier, options = {}) => {
	const key = options.byId ? 'id' : 'login';
	const value = options.byId ? identifier : identifier.toLowerCase().replace(/^@/, '');
	const response = await got('Helix')({ url: 'users', searchParams: { [key]: value } });

	if (response.statusCode === 400) {
		return null; // ungueltiger Login
	} else if (!response.ok) {
		throw new SupiError({ message: 'Helix users request failed', args: { statusCode: response.statusCode } });
	}
	return response.body.data[0] ?? null;
};

/** Channels, in denen der Bot-Account Mod ist (Scope user:read:moderated_channels); null bei Fehler */
const fetchModeratedChannels = async (userId) => {
	const result = [];
	let cursor;
	do {
		const response = await got('Helix')({
			url: 'moderation/channels',
			searchParams: { user_id: userId, first: 100, ...(cursor ? { after: cursor } : {}) },
		});
		// Fehler nie als "leere Liste" melden - sonst sieht ein Ausfall aus wie "nirgends Mod"
		if (!response.ok) {
			return null;
		}
		result.push(...response.body.data.map((i) => ({ id: i.broadcaster_id, login: i.broadcaster_login })));
		cursor = response.body.pagination?.cursor;
	} while (cursor);
	return result;
};

module.exports = { fetchTwitchUser, fetchModeratedChannels, getAppToken, getUserToken, invalidateUserToken, invalidateAppToken, storeBotRefreshToken };
