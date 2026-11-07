const { got } = require('../token/got.js');
// Client fuer die oeffentlichen (auth-freien) Endpoints von CatQuery (https://docs.catquery.com/api/), aus sb-v2s
// src/services/catquery-api.ts. Drittanbieter - alle Fehler werden abgefangen und als null/leer zurueckgegeben.

const BASE_URL = 'https://api.catquery.com';
const TIMEOUT = 5000;

const get = async (path, login) => {
	const response = await got('Global')({
		url: `${BASE_URL}${path}`,
		searchParams: { name: login },
		timeout: { request: TIMEOUT },
		throwHttpErrors: false,
	}).catch(() => null);

	return response?.ok ? response.body : null;
};

/** Bekannte fruehere Usernamen eines Accounts; leer bei Fehler oder ohne Daten */
const getKnownNames = async (login) => {
	const body = await get('/user/names', login);
	return Array.isArray(body?.names) ? body.names : [];
};

/** Ob CatQuery den Account als verdaechtig fuehrt (bekannter Scammer/Bot); null bei Fehler */
const getMonitoredStatus = async (login) => {
	const body = await get('/user/monitored', login);
	if (!body || typeof body !== 'object') {
		return null;
	}

	return { monitored: Boolean(body.monitored), reason: body.reason ?? null };
};

module.exports = { getKnownNames, getMonitoredStatus };
