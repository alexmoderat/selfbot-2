const { got } = require('./got.js');
const { fetchRoleGrant } = require('../util/mod-since.js');

/**
 * roles.tv-API (https://roles.tv/api) fuer Mod-/VIP-Listen, aus sb-v2s v2/utils/roles-tv.ts.
 * Paginiert per Cursor und nennt die echte Gesamtzahl (GQL liefert hoechstens 100 Eintraege).
 * Fremdes Projekt ohne Rate-Limit-Zusage: echte Fehler werfen, nur ein bestaetigtes 404 liefert null.
 *
 * Anders als sb-v2 (singletons/roles.ts) ohne eigene Rollen-Tabelle - alexmoderat, 23.10.2026:
 * "rollen brauchen wir gar nicht speichern kommen ja ohnehin von der roles.tv website".
 */

const BASE = 'https://roles.tv/api';
// Fallback fuer "in welchen Channels hat User X die Rolle": ttv.tools/docs (alexmoderat, 14.11.2026), eigene Daten,
// andere Parameternamen (perPage statt per_page), Route /roles/<rolle>/<login>
const TTV_BASE = 'https://ttv.tools/api';
const PER_PAGE = 100;
const MAX_PAGES = 100; // = 10.000 Eintraege
const TIMEOUT_MS = 10_000;

const paginate = async (path, { base = BASE, source = 'roles.tv', perPageParam = 'per_page' } = {}) => {
	const entries = [];
	let cursor = null;
	let total = 0;
	for (let page = 0; page < MAX_PAGES; page++) {
		const response = await got('Global')({
			url: `${base}${path}`,
			searchParams: { [perPageParam]: PER_PAGE, ...(cursor ? { after: cursor } : {}) },
			headers: { 'User-Agent': 'alexmoderat-bot' },
			timeout: { request: TIMEOUT_MS },
		}).catch((e) => {
			throw new Error(`${source} ${path} fehlgeschlagen: ${e instanceof Error ? e.message : String(e)}`);
		});

		if (response.statusCode === 404) {
			return null;
		} else if (!response.ok || typeof response.body !== 'object') {
			throw new Error(`${source} ${path} fehlgeschlagen: HTTP ${response.statusCode}`);
		}

		total = response.body.total ?? total;
		for (const row of response.body.data ?? []) {
			if (!row.login || row.active === false) {
				continue;
			}
			entries.push({
				login: row.login,
				displayName: row.displayName ?? undefined,
				grantedAt: row.grantedAt ? `${String(row.grantedAt).replace(' ', 'T')}Z` : null,
			});
		}

		cursor = response.body.cursor ?? null;
		if (!cursor) {
			break;
		}
	}

	if (cursor) {
		throw new Error(`${source} ${path}: Seitenlimit (${MAX_PAGES} Seiten) erreicht - Liste unvollstaendig`);
	}
	if (entries.length < total * 0.9) {
		throw new Error(`${source} ${path}: nur ${entries.length}/${total} Eintraege erhalten`);
	}

	return { entries, total };
};

/** Vollstaendige Rollenliste eines Channels */
const fetchChannelRoleList = (channel, role) => paginate(`/stats/channel/${role}/login/${encodeURIComponent(channel.toLowerCase())}`);

/** In welchen Channels der User diese Rolle hat */
const fetchUserRoleList = async (login, role) => {
	const name = encodeURIComponent(login.toLowerCase());
	try {
		return await paginate(`/stats/user/${role}/login/${name}`);
	} catch {
		// roles.tv down -> ttv.tools; scheitert auch das, kommt dessen Fehler hoch
		return paginate(`/roles/${role}/${name}`, { base: TTV_BASE, source: 'ttv.tools', perPageParam: 'perPage' });
	}
};

/** Rollenliste eines Channels live von roles.tv; null = Channel unbekannt */
const getChannelRoles = async (channelRaw, role) => {
	const channel = channelRaw.replace(/^[@#]+/, '').toLowerCase();
	const list = await fetchChannelRoleList(channel, role === 'mod' ? 'moderators' : 'vips');
	return list ? { channel, role, entries: list.entries } : null;
};

/**
 * Einzelpruefung fuer mc/vc. Fehlt roles.tv der grantedAt, wird gezielt per GQL fuer genau diesen User
 * nachgefragt (sb-v2, alexmoderat 30.09.2026: "kriegt man das nicht per gql zumindest fuer mich").
 * Fehlt der User bei roles.tv ganz, ebenfalls: roles.tv kennt frisch vergebene Rollen erst verzoegert
 * (alexmoderat, 06.11.2026: pearxs seit 18 Minuten Mod in #jessekettle, mc sagte "not a mod").
 */
const checkRole = async (channelRaw, userRaw, role) => {
	const list = await getChannelRoles(channelRaw, role);
	if (!list) {
		return null;
	}

	const user = userRaw.replace(/^[@#]+/, '').toLowerCase();
	let entry = list.entries.find((i) => i.login.toLowerCase() === user);
	if (!entry || !entry.grantedAt) {
		const grantedAt = await fetchRoleGrant(list.channel, user, role).catch(() => null);
		if (grantedAt) {
			entry = { ...(entry ?? { login: user }), grantedAt };
		}
	}

	return { found: Boolean(entry), entry, list };
};

module.exports = { fetchChannelRoleList, fetchUserRoleList, getChannelRoles, checkRole };
