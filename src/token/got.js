const { request, HttpError } = require('./http.js');
const { getAppToken, getUserToken, getUserClientId } = require('./helix.js');

// Ersatz fuer supi-core GotRegistry mit derselben Aufrufform wie bisher:
//   await got('Helix')({ url: 'users', searchParams: { login } })  ->  { ok, statusCode, body, headers }
// Instanzen wie selfbots gots/: Global (wirft nie), GenericAPI (wirft bei HTTP-Fehlern), Helix (User-Token),
// HelixApp (App-Token), IVR, TwitchGQL (oeffentliche Client-ID, ohne Login).

const GQL_PUBLIC_CLIENT_ID = 'kimne78kx3ncx6brgo4mv6wki5h1ko';
const RETRY_STATUS = new Set([408, 429, 500, 502, 503, 504, 521, 522, 524]);
const RETRY_METHODS = new Set(['GET', 'PUT', 'HEAD', 'DELETE', 'OPTIONS']);

const helixHeaders = async (kind) => ({
	'Client-Id': kind === 'app' ? process.env.TWITCH_CLIENT_ID : getUserClientId(),
	Authorization: `Bearer ${kind === 'app' ? await getAppToken() : await getUserToken()}`,
});

const INSTANCES = {
	Global: { prefixUrl: null, timeout: 10_000, retry: 2, throwHttpErrors: false },
	GenericAPI: { prefixUrl: null, timeout: 10_000, retry: 2, throwHttpErrors: true },
	Helix: { prefixUrl: 'https://api.twitch.tv/helix/', timeout: 5000, retry: 2, throwHttpErrors: false, headers: () => helixHeaders('user') },
	HelixApp: { prefixUrl: 'https://api.twitch.tv/helix/', timeout: 5000, retry: 2, throwHttpErrors: false, headers: () => helixHeaders('app') },
	IVR: { prefixUrl: 'https://api.ivr.fi/', timeout: 10_000, retry: 2, throwHttpErrors: false },
	TwitchGQL: {
		prefixUrl: 'https://gql.twitch.tv/',
		timeout: 10_000,
		retry: 0,
		throwHttpErrors: false,
		method: 'POST',
		headers: () => ({
			Accept: '*/*',
			'Accept-Language': 'en-US',
			'Client-ID': GQL_PUBLIC_CLIENT_ID,
			'Content-Type': 'text/plain;charset=UTF-8',
			Referer: 'https://www.twitch.tv',
		}),
	},
};

const resolveUrl = (prefixUrl, url) => {
	const value = String(url);
	if (!prefixUrl || /^https?:\/\//.test(value)) {
		return value;
	}
	return prefixUrl + value.replace(/^\//, '');
};

/** Timeout wie bei got: Zahl oder { request: ms } */
const timeoutOf = (value, fallback) => (typeof value === 'number' ? value : (value?.request ?? fallback));

const run = async (instance, options) => {
	const method = (options.method ?? instance.method ?? 'GET').toUpperCase();
	const headers = { ...(instance.headers ? await instance.headers() : {}), ...options.headers };
	const throwHttpErrors = options.throwHttpErrors ?? instance.throwHttpErrors;
	const attempts = RETRY_METHODS.has(method) ? 1 + (options.retry?.limit ?? instance.retry) : 1;

	let lastError = null;
	for (let attempt = 0; attempt < attempts; attempt++) {
		try {
			const response = await request({
				url: resolveUrl(instance.prefixUrl, options.url),
				method,
				searchParams: options.searchParams,
				json: options.json,
				body: options.form ? new URLSearchParams(options.form).toString() : options.body,
				headers: options.form ? { 'Content-Type': 'application/x-www-form-urlencoded', ...headers } : headers,
				responseType: options.responseType ?? 'json',
				timeout: timeoutOf(options.timeout, instance.timeout),
			});

			if (RETRY_STATUS.has(response.statusCode) && attempt < attempts - 1) {
				await new Promise((resolve) => setTimeout(resolve, 500 * (attempt + 1)));
				continue;
			}
			if (throwHttpErrors && !response.ok) {
				throw new HttpError(`Response code ${response.statusCode}`, { statusCode: response.statusCode, url: options.url, body: response.body });
			}
			return response;
		} catch (e) {
			lastError = e;
			// HTTP-Fehler (throwHttpErrors) nicht wiederholen, Netzwerkfehler schon
			if (e.statusCode !== undefined || attempt === attempts - 1) {
				throw e;
			}
			await new Promise((resolve) => setTimeout(resolve, 500 * (attempt + 1)));
		}
	}
	throw lastError;
};

/** @param {keyof INSTANCES} name */
const got = (name) => {
	const instance = INSTANCES[name];
	if (!instance) {
		throw new Error(`Unknown Got instance "${name}"`);
	}
	return (options) => run(instance, options);
};

/** GraphQL wie supi-core Got.gql: POST { query, variables }, wirft bei HTTP-Fehlern */
got.gql = (options) => {
	const { url, query, variables, token, headers, instance, ...rest } = options;
	const base = instance ? INSTANCES[instance] : { prefixUrl: null, timeout: 10_000, retry: 0 };
	return run(
		{ ...base, throwHttpErrors: true },
		{
			...rest,
			url,
			method: 'POST',
			headers: token ? { ...headers, authorization: `Bearer ${token}` } : headers,
			json: variables ? { query, variables } : { query },
		},
	);
};

module.exports = { got, GQL_PUBLIC_CLIENT_ID, INSTANCES };
