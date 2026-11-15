const { got } = require('../token/got.js');

/**
 * Globale Twitch-Badges direkt aus Twitch-GQL (Abfrage wie in Tackling/Twitch-Badge-Bot; alexmoderat, 15.11.2026: "zur Sicherheit
 * den GQL Endpunkt nehmen"). Kein Login noetig, nur die oeffentliche Web-Client-ID. Gleiche Schluessel wie streamdatabase.js
 * ("set_id:version"), damit der gemerkte Stand zwischen beiden Quellen austauschbar bleibt.
 */
const GQL_URL = 'https://gql.twitch.tv/gql';
const CLIENT_ID = 'kimne78kx3ncx6brgo4mv6wki5h1ko';
const QUERY = 'query GlobalBadges { badges { setID version title description user { id } } }';

/** GQL-Antwort -> [{ key, title, description, addedAt }], nur globale Badges (ohne Channel-Zuordnung) */
const parseGqlBadges = (body) => {
	const list = body?.data?.badges;
	if (!Array.isArray(list)) {
		throw new Error('GQL: Badge-Liste fehlt');
	}

	return list
		.filter((i) => i?.setID && i.version !== undefined && !i.user)
		.map((i) => ({ key: `${i.setID}:${i.version}`, title: String(i.title ?? i.setID), description: String(i.description ?? ''), addedAt: null }));
};

const fetchGqlBadges = async () => {
	const response = await got('Global')({
		url: GQL_URL,
		method: 'POST',
		headers: { 'Client-ID': CLIENT_ID },
		json: { query: QUERY },
		responseType: 'json',
		timeout: { request: 20_000 },
	});
	if (!response.ok) {
		throw new Error(`twitch gql badges: HTTP ${response.statusCode}`);
	}

	return parseGqlBadges(response.body);
};

module.exports = { parseGqlBadges, fetchGqlBadges };
