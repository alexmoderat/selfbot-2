const { gqlAuth } = require('./twitch-gql.js');

/**
 * Seit wann jemand in einem Channel Mod ist (ninou2, 06.11.2026: "be great if could add the dates to when each channel
 * gave the mod"). Helix kennt kein Datum; GQL liefert es nur in der Mod-Liste des Channels (user.mods, edge.grantedAt)
 * und nur mit Login (TWITCH_WEB_TOKEN) - ein "moderatedChannels mit Datum" fuer das eigene Konto gibt es nicht.
 * Deshalb pro Channel die Mod-Liste durchblaettern, bis der Login auftaucht, und das Ergebnis zwischenspeichern.
 */
const PAGE_SIZE = 100;
const MAX_PAGES = 20;
const CONCURRENCY = 5;
const FOUND_EXPIRY = 30 * 864e5;
const MISSING_EXPIRY = 864e5;
const NOT_FOUND = '-';

const cacheKey = (channel, mod) => `mod-since-${channel}-${mod}`;

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

/** Ein Channel: zuerst Cache, sonst GQL; Fehler ergeben null und werden nicht gespeichert */
const getModSince = async (channel, mod) => {
	const key = cacheKey(channel, mod);
	const cached = await bot.Redis.getJSON(key);
	if (cached) {
		return cached === NOT_FOUND ? null : cached;
	}

	let grant;
	try {
		grant = await fetchRoleGrant(channel, mod);
	} catch {
		return null;
	}

	await bot.Redis.setJSON(key, grant ?? NOT_FOUND, grant ? FOUND_EXPIRY : MISSING_EXPIRY);
	return grant;
};

/** Viele Channels mit begrenzter Parallelitaet; Ergebnis Login -> grantedAt (oder null) */
const getModSinceMany = async (channels, mod) => {
	const result = new Map();
	let next = 0;
	const worker = async () => {
		while (next < channels.length) {
			const channel = channels[next++];
			result.set(channel, await getModSince(channel, mod));
		}
	};

	await Promise.all(Array.from({ length: Math.min(CONCURRENCY, channels.length) }, worker));
	return result;
};

/** Aelteste zuerst, ohne Datum ans Ende, sonst alphabetisch */
const sortBySince = (rows) =>
	[...rows].sort((a, b) => {
		if (a.since && b.since) {
			return a.since.localeCompare(b.since) || a.login.localeCompare(b.login);
		}

		return a.since ? -1 : b.since ? 1 : a.login.localeCompare(b.login);
	});

module.exports = { findGrant, fetchRoleGrant, getModSince, getModSinceMany, sortBySince };
