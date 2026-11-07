// Duenner fetch-Wrapper statt supi-core GotRegistry: Timeout, JSON, Query-Parameter.
// Antwort immer { ok, statusCode, body, headers }, wirft nur bei Netzwerkfehlern/Timeout (HttpError).

const USER_AGENT = 'selfbot-next (Twitch bot of alexmoderat)';
const DEFAULT_TIMEOUT = 10_000;

class HttpError extends Error {
	constructor(message, data = {}) {
		super(message);
		this.name = 'HttpError';
		Object.assign(this, data);
	}
}

const buildUrl = (url, searchParams) => {
	if (!searchParams) {
		return url;
	}
	const target = new URL(url);
	const entries = searchParams instanceof URLSearchParams ? [...searchParams.entries()] : Object.entries(searchParams);
	for (const [key, value] of entries) {
		if (value === undefined || value === null) {
			continue;
		}
		if (Array.isArray(value)) {
			value.forEach((item) => target.searchParams.append(key, String(item)));
		}
		else {
			target.searchParams.append(key, String(value));
		}
	}
	return target.toString();
};

/**
 * @param {object} options
 * @param {string} options.url
 * @param {string} [options.method]
 * @param {object|URLSearchParams} [options.searchParams]
 * @param {object} [options.json]
 * @param {string} [options.body]
 * @param {object} [options.headers]
 * @param {"json"|"text"} [options.responseType]
 * @param {number} [options.timeout]
 */
const request = async (options) => {
	const headers = { 'User-Agent': USER_AGENT, ...options.headers };
	let body = options.body;
	if (options.json !== undefined) {
		headers['Content-Type'] = 'application/json';
		body = JSON.stringify(options.json);
	}

	const url = buildUrl(options.url, options.searchParams);
	let response;
	try {
		response = await fetch(url, {
			method: options.method ?? 'GET',
			headers,
			body,
			signal: AbortSignal.timeout(options.timeout ?? DEFAULT_TIMEOUT),
		});
	}
	catch (e) {
		throw new HttpError(`Request failed: ${e.message}`, { url: options.url, cause: e });
	}

	const text = await response.text();
	let parsed = text;
	if ((options.responseType ?? 'json') === 'json' && text.length > 0) {
		try {
			parsed = JSON.parse(text);
		}
		catch {
			parsed = text;
		}
	}

	return { ok: response.ok, statusCode: response.status, body: parsed, headers: response.headers };
};

const isHttpError = (error) => error instanceof HttpError;

module.exports = { request, HttpError, isHttpError, USER_AGENT };
