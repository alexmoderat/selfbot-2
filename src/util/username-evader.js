// Username-Muster bekannter Ban-Evader je Channel, aus sb-v2s chat-modules/username-evader-ban.
// Ein Evader in #mtxei erstellt immer wieder neue Accounts mit "mystic" im Namen
// (buhmystic, arunimystic, mysticyonr6, positivemystic, ...).

const USERNAME_EVADER_PATTERNS = {
	mtxei: [/mystic/i, /clancy/i, /ceo/i],
};

/** Passendes Muster fuer einen Login in einem Channel, sonst null */
const findEvaderPattern = (channel, login) => USERNAME_EVADER_PATTERNS[channel.toLowerCase()]?.find((i) => i.test(login)) ?? null;

module.exports = { USERNAME_EVADER_PATTERNS, findEvaderPattern };
