const { request } = require('./http.js');

// Twitch-Tokens und Helix-Aufrufe (bisher platforms/twitch-utils.ts + gots/helix, gots/helix-app)

const APP_TOKEN_KEY = 'twitch-app-token';
const USER_TOKEN_KEY = 'twitch-user-token';
const REFRESH_TOKEN_KEY = 'twitch-refresh-token';
const HELIX = 'https://api.twitch.tv/helix/';

const requireEnv = (name) => {
	const value = process.env[name];
	if (!value) {
		throw new Error(`Missing env value ${name}`);
	}
	return value;
};

const requestToken = async (params) => {
	const response = await request({
		method: 'POST',
		url: 'https://id.twitch.tv/oauth2/token',
		searchParams: { client_id: requireEnv('TWITCH_CLIENT_ID'), client_secret: requireEnv('TWITCH_CLIENT_SECRET'), ...params },
	});
	if (!response.ok) {
		throw new Error(`Twitch token request failed (${response.statusCode}, ${params.grant_type})`);
	}
	return response.body;
};

let appTokenPromise = null;
const getAppToken = async () => {
	const cached = await bot.Redis.getJSON(APP_TOKEN_KEY);
	if (cached) {
		return cached;
	}
	appTokenPromise ??= (async () => {
		const body = await requestToken({ grant_type: 'client_credentials' });
		await bot.Redis.setJSON(APP_TOKEN_KEY, body.access_token, Math.max(60, body.expires_in - 300) * 1000);
		return body.access_token;
	})().finally(() => {
		appTokenPromise = null;
	});
	return await appTokenPromise;
};

/**
 * Neue Werte in .env gewinnen gegen den in Redis gespeicherten Refresh-Token: Redis merkt sich, aus welchem
 * .env-Token der Stand stammt (Supibot-Falle: dort gewinnt Redis fuer immer)
 */
const resolveRefreshToken = (envToken, stored) => (stored && stored.source === envToken ? stored.current : envToken);

let userTokenPromise = null;
const getUserToken = async () => {
	const cached = await bot.Redis.getJSON(USER_TOKEN_KEY);
	if (cached) {
		return cached;
	}
	userTokenPromise ??= (async () => {
		const envToken = requireEnv('TWITCH_REFRESH_TOKEN');
		const stored = await bot.Redis.getJSON(REFRESH_TOKEN_KEY);
		const refreshToken = resolveRefreshToken(envToken, stored);

		const body = await requestToken({ grant_type: 'refresh_token', refresh_token: refreshToken });
		if (body.refresh_token && body.refresh_token !== refreshToken) {
			await bot.Redis.setJSON(REFRESH_TOKEN_KEY, { source: envToken, current: body.refresh_token });
		}
		await bot.Redis.setJSON(USER_TOKEN_KEY, body.access_token, Math.max(60, body.expires_in - 300) * 1000);
		return body.access_token;
	})().finally(() => {
		userTokenPromise = null;
	});
	return await userTokenPromise;
};

/** Neuer Refresh-Token des Bot-Kontos (Web-Login /bot-auth), alter Access-Token wird verworfen */
const storeBotRefreshToken = async (refreshToken) => {
	await bot.Redis.setJSON(REFRESH_TOKEN_KEY, { source: requireEnv('TWITCH_REFRESH_TOKEN'), current: refreshToken });
	await bot.Redis.setJSON(USER_TOKEN_KEY, null);
};

const invalidateUserToken = () => bot.Redis.setJSON(USER_TOKEN_KEY, null);
const invalidateAppToken = () => bot.Redis.setJSON(APP_TOKEN_KEY, null);

/**
 * Helix-Aufruf; mit app: true per App-Token, sonst per User-Token des Bots. Bei 401 einmal neuer Token.
 * @returns {Promise<{ ok: boolean, statusCode: number, body: any, headers: Headers }>}
 */
const helix = async (path, options = {}) => {
	const { app = false, ...rest } = options;
	const run = async () => {
		const token = app ? await getAppToken() : await getUserToken();
		return await request({
			...rest,
			url: path.startsWith('http') ? path : HELIX + path,
			headers: { 'Client-Id': requireEnv('TWITCH_CLIENT_ID'), Authorization: `Bearer ${token}`, ...rest.headers },
		});
	};

	let response = await run();
	if (response.statusCode === 401) {
		await (app ? invalidateAppToken() : invalidateUserToken());
		response = await run();
	}
	return response;
};

module.exports = {
	getAppToken,
	getUserToken,
	resolveRefreshToken,
	storeBotRefreshToken,
	invalidateUserToken,
	invalidateAppToken,
	helix,
};
