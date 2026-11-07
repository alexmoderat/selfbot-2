const { fetchTwitchUser } = require('../../../util/twitch/twitch-utils.js');

/** Twitch-ID zu einem Login: bekannter User zuerst, sonst Helix */
const fetchUserTwitchId = async (login) => {
	const known = await bot.Users.get(login);
	if (known?.twitchId) {
		return known.twitchId;
	}

	return (await fetchTwitchUser(login).catch(() => null))?.id ?? null;
};

module.exports = { fetchUserTwitchId };
