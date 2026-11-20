const { got } = require('./got.js');
const { randomBytes } = require('node:crypto');

/**
 * OAuth-Tokens der Nutzer (Block 9), aus sb-v2s auth-server.ts (getValidToken, forceRefreshToken, generateAuthUrl).
 * Ausgestellt ueber sb-v2s Auth-App (TWITCH_AUTH_CLIENT_ID/SECRET) - damit lassen sich sb-v2s user_tokens beim Umstieg
 * uebernehmen (alexmoderat, 24.10.2026). Die Redirect-URL ${WEB_BASE_URL}/callback muss in dieser App eingetragen sein.
 */
const STATE_PREFIX = 'selfbot-oauth-state-';
const STATE_TTL = 30 * 60_000;
const REFRESH_MARGIN = 5 * 60_000;

// Wie sb-v2s generateAuthUrl (Nutzer-Links)
const USER_SCOPES = [
	'chat:read',
	'chat:edit',
	'user:read:chat',
	'user:write:chat',
	'user:bot',
	'moderator:manage:automod',
	'moderator:manage:automod_settings',
	'moderator:read:suspicious_users',
	'moderator:manage:chat_messages',
	'moderator:manage:chat_settings',
	'moderator:manage:blocked_terms',
	'moderator:read:chatters',
	'user:manage:chat_color',
	'channel:manage:broadcast',
	'channel:manage:vips',
	'user:read:follows',
	'moderator:manage:banned_users',
	'moderation:read',
	'user:read:moderated_channels',
	'user:manage:blocked_users',
	'moderator:read:followers',
	'moderator:manage:warnings',
	'channel:manage:moderators',
	'channel:moderate',
	'channel:read:stream_key',
	'moderator:manage:unban_requests',
	'moderator:read:moderators',
	'moderator:read:vips',
	'channel:read:subscriptions',
];
const ADD_BOT_SCOPES = ['chat:read', 'chat:edit', 'moderator:manage:banned_users', 'moderator:manage:suspicious_users', 'channel:read:subscriptions', 'moderator:read:followers'];

const baseUrl = () => (process.env.WEB_BASE_URL ?? '').replace(/\/+$/, '');
const authClient = () => {
	const id = process.env.TWITCH_AUTH_CLIENT_ID;
	const secret = process.env.TWITCH_AUTH_CLIENT_SECRET;
	return id && secret ? { id, secret } : null;
};

/** Link fuer einen Nutzer, der sich autorisieren soll (followage, settitle, ...) */
const authLink = (login) => `${baseUrl()}/auth/${encodeURIComponent(login.toLowerCase())}`;

const createState = async (data) => {
	const state = randomBytes(16).toString('hex');
	await bot.Cache.setJSON(`${STATE_PREFIX}${state}`, JSON.stringify(data), STATE_TTL);
	return state;
};

const consumeState = async (state) => {
	const key = `${STATE_PREFIX}${state}`;
	const raw = await bot.Cache.getJSON(key);
	if (!raw) {
		return null;
	}
	await bot.Cache.setJSON(key, null, 1);
	return JSON.parse(raw);
};

/** Twitch-Autorisierungs-URL; clientId = Auth-App, beim Bot-Konto die eigene App (TWITCH_CLIENT_ID) */
const buildAuthorizeUrl = (options) => {
	const params = new URLSearchParams({
		client_id: options.clientId,
		redirect_uri: `${baseUrl()}${options.redirectPath}`,
		response_type: 'code',
		scope: options.scopes.join(' '),
		state: options.state,
		force_verify: String(options.forceVerify),
	});
	return `https://id.twitch.tv/oauth2/authorize?${params.toString()}`;
};

const exchangeCode = async (code, client, redirectPath) => {
	const response = await got('Global')({
		method: 'POST',
		url: 'https://id.twitch.tv/oauth2/token',
		form: {
			client_id: client.id,
			client_secret: client.secret,
			code,
			grant_type: 'authorization_code',
			redirect_uri: `${baseUrl()}${redirectPath}`,
		},
	});
	if (!response.ok) {
		throw new Error(`Token-Tausch fehlgeschlagen (${response.statusCode}): ${JSON.stringify(response.body)}`);
	}
	return response.body;
};

/** Wem gehoert der Token (oauth2/validate)? null bei ungueltigem Token */
const validateToken = async (accessToken) => {
	const response = await got('Global')({
		url: 'https://id.twitch.tv/oauth2/validate',
		headers: { Authorization: `Bearer ${accessToken}` },
	}).catch(() => null);
	return response?.ok ? response.body : null;
};

const saveToken = async (login, userId, token) => {
	await bot.DB.UserToken.updateOne(
		{ login: login.toLowerCase() },
		{
			$set: {
				userId,
				accessToken: token.access_token,
				refreshToken: token.refresh_token ?? null,
				expires: Date.now() + token.expires_in * 1000,
				updated: new Date(),
			},
		},
		{ upsert: true },
	);
};

/** { login, userId, accessToken, refreshToken, expires } oder null */
const getToken = async (login) => await bot.DB.UserToken.findOne({ login: login.toLowerCase() }).lean();

const refresh = async (row) => {
	const client = authClient();
	if (!client || !row.refreshToken) {
		return null;
	}

	const response = await got('Global')({
		method: 'POST',
		url: 'https://id.twitch.tv/oauth2/token',
		form: { client_id: client.id, client_secret: client.secret, grant_type: 'refresh_token', refresh_token: row.refreshToken },
	}).catch(() => null);

	if (!response?.ok) {
		console.warn(`[user-tokens] Erneuern fehlgeschlagen fuer ${row.login}: ${response?.statusCode ?? 'Netzwerk'}`);
		return null;
	}

	await saveToken(row.login, row.userId, response.body);
	return response.body.access_token;
};

/** Gueltiger Access-Token, 5 min vor Ablauf erneuert; null ohne Token oder wenn Erneuern scheitert */
const getValidToken = async (login) => {
	const row = await getToken(login);
	if (!row) {
		return null;
	}
	if (row.expires && Date.now() > Number(row.expires) - REFRESH_MARGIN) {
		return await refresh(row);
	}
	return row.accessToken;
};

/** Nach einem 401 erneuern, egal was Expires sagt */
const forceRefreshToken = async (login) => {
	const row = await getToken(login);
	return row ? await refresh(row) : null;
};

/** Helix mit einem Nutzer-Token (Client-ID der Auth-App) - fuer followage, settitle/setgame, /v1 */
const helixAsUser = async (token, options) => {
	const client = authClient();
	return await got('Global')({
		method: options.method ?? 'GET',
		url: `https://api.twitch.tv/helix/${options.url}`,
		searchParams: options.searchParams,
		...(options.json !== undefined ? { json: options.json } : {}),
		headers: { Authorization: `Bearer ${token}`, 'Client-Id': client?.id ?? '' },
		timeout: { request: 8000 },
	});
};

module.exports = {
	USER_SCOPES,
	ADD_BOT_SCOPES,
	baseUrl,
	authClient,
	authLink,
	createState,
	consumeState,
	buildAuthorizeUrl,
	exchangeCode,
	validateToken,
	saveToken,
	getToken,
	getValidToken,
	forceRefreshToken,
	helixAsUser,
};
