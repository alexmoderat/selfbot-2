const { got } = require('../token/got.js');

const utilityDb = require('../database/utility.js');

const { timingSafeEqual } = require('node:crypto');

const { Router } = require('express');

const { fetchTwitchUser } = require('../util/twitch/twitch-utils.js');

const { pubsub } = require('../util/pubsub.js');

const { getBanStatusBatch, getChatRestrictedReasons, getUserProfile, gqlPublic } = require('../token/gql.js');

const { getKnownNames, getMonitoredStatus } = require('../token/catquery-api.js');

const { splitKind, summarize } = require('../util/sightings.js');

const { findLiveChatters } = require('../util/live-chatters.js');

const { fetchChatters } = require('../token/twitch-lists.js');

const { getToken, getValidToken, helixAsUser } = require('../token/user-tokens.js');

const { chatLogs } = require('./public.js');

/**
 * Oeffentliche API /v1/* mit API-Keys (WEB_API_KEYS, Bearer), /v1/public/bots, POST /v1/bots (WEB_BOTLIST_UPLOAD_TOKEN)
 * und /public/twitch/user (20 Anfragen/min je IP), aus sb-v2s auth-server.ts - Antwortformen unveraendert.
 * tackling.cc-Endpunkte (founders, usernameavailable, userfollows-Rueckfall) wie in sb-v2, der Dienst antwortete am
 * 24.10.2026 mit 503.
 */
const one = (value) => (Array.isArray(value) ? String(value[0] ?? '') : value === undefined || value === null ? '' : String(value));

const lower = (value) => one(value).toLowerCase().replace(/^[@#]/, '').trim();

const isValidApiKey = (token, keys) => {
	if (!token) {
		return false;
	}
	const given = Buffer.from(token);
	return keys.some((key) => {
		const expected = Buffer.from(key);
		return expected.length === given.length && timingSafeEqual(expected, given);
	});
};

const bearerToken = (header) => {
	const match = /^Bearer\s+(.+)$/i.exec(header ?? '');
	return match ? match[1].trim() : null;
};

const apiKeys = () =>
	(process.env.WEB_API_KEYS ?? '')
		.split(',')
		.map((i) => i.trim())
		.filter(Boolean);

const requireApiKey = (req, res, next) => {
	if (!isValidApiKey(bearerToken(req.headers.authorization), apiKeys())) {
		res.setHeader('WWW-Authenticate', 'Bearer');
		res.status(401).json({ error: 'Unauthorized' });
		return;
	}
	next();
};

const tackling = async (path, params) => {
	const response = await got('GenericAPI')({
		url: `https://api.tackling.cc${path}`,
		searchParams: params,
		timeout: { request: 8000 },
	});
	return response.body;
};

const helix = async (url, searchParams) => {
	const response = await got('Helix')({ url, searchParams });
	if (!response.ok) {
		throw new Error(`Helix ${url}: ${response.statusCode}`);
	}
	return response.body;
};

const banStatus = async (login) => (await getBanStatusBatch([login])).get(login.toLowerCase()) ?? null;

const recentChatters = async (channelName, minutes) => {
	const channel = bot.Channels.get(channelName);
	if (!channel) {
		return { chatters: [], messages: 0 };
	}
	const since = new Date(Date.now() - Math.trunc(minutes) * 60_000);
	const rows = await bot.DB.ChatLine.aggregate([{ $match: { channel: channel.id, posted: { $gt: since } } }, { $group: { _id: '$userId', count: { $sum: 1 } } }]);
	const users = await bot.DB.User.find({ twitchId: { $in: rows.map((i) => i._id) } }, { name: 1, twitchId: 1 }).lean();
	const names = new Map(users.map((i) => [i.twitchId, i.name]));
	const chatters = rows.map((i) => ({ username: names.get(i._id) ?? i._id, userId: i._id, count: Number(i.count) }));
	return { chatters, messages: chatters.reduce((sum, i) => sum + i.count, 0) };
};

const userPair = async (user, channel) => {
	const data = await gqlPublic(`{
		u: userResultByLogin(login: ${JSON.stringify(user)}) { __typename ... on User { id login displayName } }
		c: userResultByLogin(login: ${JSON.stringify(channel)}) { __typename ... on User { id login displayName } }
	}`);
	const pick = (value) => (value?.__typename === 'User' && value.id ? { id: value.id, login: value.login ?? '', displayName: value.displayName ?? '' } : null);
	return { u: pick(data?.u ?? null), c: pick(data?.c ?? null) };
};

// followed_at braucht Mod-Rechte des Bots im Channel; null = nicht gefolgt ODER kein Mod
const helixFollowedAt = async (userId, broadcasterId) => {
	const response = await got('Helix')({
		url: 'channels/followers',
		searchParams: { broadcaster_id: broadcasterId, user_id: userId, first: 1 },
	}).catch(() => null);
	return response?.ok ? (response.body.data[0]?.followed_at ?? null) : null;
};

// Sub-Status braucht den Token des Broadcasters (channel:read:subscriptions)
const helixSubInfo = async (userId, broadcasterId, broadcasterLogin) => {
	const token = await getValidToken(broadcasterLogin);
	if (!token) {
		return null;
	}
	const response = await helixAsUser(token, {
		url: 'subscriptions',
		searchParams: { broadcaster_id: broadcasterId, user_id: userId },
	}).catch(() => null);
	return response?.ok ? (response.body.data[0] ?? null) : null;
};

const PUBLIC_RATE_LIMIT = 20;

const PUBLIC_RATE_WINDOW = 60_000;

const publicRateLimits = new Map();

setInterval(() => {
	const now = Date.now();
	for (const [ip, entry] of publicRateLimits) {
		if (entry.resetAt < now) {
			publicRateLimits.delete(ip);
		}
	}
}, 5 * 60_000).unref();

const publicRateLimit = (req, res, next) => {
	const ip =
		String(req.headers['x-forwarded-for'] ?? '')
			.split(',')[0]
			.trim() ||
		req.socket.remoteAddress ||
		'unknown';
	const now = Date.now();
	const entry = publicRateLimits.get(ip);
	if (!entry || entry.resetAt < now) {
		publicRateLimits.set(ip, { count: 1, resetAt: now + PUBLIC_RATE_WINDOW });
		next();
		return;
	}
	if (entry.count >= PUBLIC_RATE_LIMIT) {
		const retryAfter = Math.ceil((entry.resetAt - now) / 1000);
		res.set('Retry-After', String(retryAfter));
		res.status(429).json({ error: 'Rate limit exceeded', retryAfterSeconds: retryAfter });
		return;
	}
	entry.count++;
	next();
};

const route = (handler) => (req, res) => {
	handler(req, res).catch((e) => {
		res.status(500).json({ error: e instanceof Error ? e.message : String(e) });
	});
};

const subAndFollow = async (req, res, withMeta) => {
	const user = lower(req.query.user);
	const channel = lower(req.query.channel);
	if (!user || !channel) {
		return res.status(400).json({ error: 'Missing: user, channel' });
	}
	const { u, c } = await userPair(user, channel);
	if (!u || !c) {
		return res.status(404).json({ error: 'User oder Channel nicht gefunden' });
	}
	const [subInfo, followedAt] = await Promise.all([helixSubInfo(u.id, c.id, channel), helixFollowedAt(u.id, c.id)]);
	const subscription = subInfo ? { tier: subInfo.tier, isGift: subInfo.is_gift, gifterName: subInfo.gifter_name || null } : null;
	const base = { user: u, channel: c, followedAt };
	if (!withMeta) {
		return res.json({ ...base, subscription, cumulative: null, streak: null, source: 'helix-direct' });
	}
	return res.json({
		...base,
		statusHidden: false,
		subscription,
		cumulative: null,
		streak: null,
		meta: { followAccessible: followedAt !== null, subAccessible: Boolean((await getToken(channel))?.Access_Token) },
		source: 'helix-direct',
	});
};

module.exports = {
	got,
	utilityDb,
	timingSafeEqual,
	Router,
	fetchTwitchUser,
	pubsub,
	getBanStatusBatch,
	getChatRestrictedReasons,
	getUserProfile,
	gqlPublic,
	getKnownNames,
	getMonitoredStatus,
	splitKind,
	summarize,
	findLiveChatters,
	fetchChatters,
	getToken,
	getValidToken,
	helixAsUser,
	chatLogs,
	one,
	lower,
	isValidApiKey,
	bearerToken,
	apiKeys,
	requireApiKey,
	tackling,
	helix,
	banStatus,
	recentChatters,
	userPair,
	helixFollowedAt,
	helixSubInfo,
	PUBLIC_RATE_LIMIT,
	PUBLIC_RATE_WINDOW,
	publicRateLimits,
	publicRateLimit,
	route,
	subAndFollow,
};
