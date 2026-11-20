const { gqlAuth } = require('../token/gql.js');

/**
 * Seit wann jemand in einem Channel Mod/VIP ist: GQL liefert das nur in der Mod-/VIP-Liste des Channels (edge.grantedAt)
 * und nur mit Login (TWITCH_WEB_TOKEN). Genutzt von mc/vc fuer frisch vergebene Rollen, die roles.tv noch nicht kennt.
 * Die Daten je Channel in der Liste von !ml (ninou2, 06.11.2026) sind wieder raus (alexmoderat, 11.11.2026).
 */
const PAGE_SIZE = 100;
const MAX_PAGES = 20;

/** grantedAt fuer den Login aus einer Seite, sonst null */
const findGrant = (edges, login) => edges.find((i) => i?.node?.login === login)?.grantedAt ?? null;

/**
 * grantedAt einer Rolle direkt aus der Mod-/VIP-Liste des Channels, ohne Cache. null = nicht in der Liste;
 * GQL-Fehler werfen. Auch fuer mc/vc, wenn roles.tv einen frisch vergebenen Mod noch nicht kennt
 * (alexmoderat, 06.11.2026: "sb mc pearxs jessekettle" -> "not a mod", PotatBotat: seit 18 Minuten Mod).
 */
const fetchRoleGrant = async (channel, login, role = 'mod') => {
	const field = role === 'mod' ? 'mods' : 'vips';
	const target = login.toLowerCase();
	let cursor = null;
	for (let page = 0; page < MAX_PAGES; page++) {
		const after = cursor ? `, after: ${JSON.stringify(cursor)}` : '';
		const data = await gqlAuth({
			query: `{ user(login: ${JSON.stringify(channel)}) { mods: ${field}(first: ${PAGE_SIZE}${after}) { edges { cursor grantedAt node { login } } pageInfo { hasNextPage } } } }`,
		});

		const mods = data.user?.mods;
		if (!mods) {
			return null;
		}

		const grant = findGrant(mods.edges, target);
		if (grant) {
			return grant;
		}

		cursor = mods.edges.at(-1)?.cursor ?? null;
		if (!mods.pageInfo.hasNextPage || !cursor) {
			return null;
		}
	}

	return null;
};

module.exports = { findGrant, fetchRoleGrant };
