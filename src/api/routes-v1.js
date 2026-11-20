const { got } = require('../token/got.js');
const sbv2 = require('../database/sbv2.js');
const { timingSafeEqual } = require('node:crypto');

const { Router } = require('express');

const { fetchTwitchUser } = require('../util/twitch/twitch-utils.js');
const { pubsub } = require('../util/pubsub.js');
const { getBanStatusBatch, getChatRestrictedReasons, getUserProfile, gqlPublic } = require('../misc/twitch-gql.js');
const { getKnownNames, getMonitoredStatus } = require('../misc/catquery-api.js');
const { splitKind, summarize } = require('../misc/sightings.js');
const { findLiveChatters } = require('../misc/live-chatters.js');
const { fetchChatters } = require('../misc/twitch-lists.js');
const { getToken, getValidToken, helixAsUser } = require('../misc/user-tokens.js');
const { chatLogs } = require('./routes-public.js');

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
	const rows = await bot.DB.ChatLine.aggregate([
		{ $match: { channel: channel.id, posted: { $gt: since } } },
		{ $group: { _id: '$userId', count: { $sum: 1 } } },
	]);
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
	const pick = (value) =>
		value?.__typename === 'User' && value.id ? { id: value.id, login: value.login ?? '', displayName: value.displayName ?? '' } : null;
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

const createV1Router = () => {
	const router = Router();
	const route = (handler) => (req, res) => {
		handler(req, res).catch((e) => {
			res.status(500).json({ error: e instanceof Error ? e.message : String(e) });
		});
	};
	const v1 = (path, handler) => router.get(path, requireApiKey, route(handler));

	v1('/v1/sightings', async (req, res) => {
		const name = lower(req.query.name);
		if (!name) {
			return res.status(400).json({ error: 'Missing: name' });
		}
		const user = await fetchTwitchUser(name);
		if (!user) {
			return res.status(404).json({ error: 'User not found' });
		}
		const rows = await sbv2.query(
			'SELECT channel AS Channel_Name, seen_at AS Seen_At, normalized_text AS Normalized_Text FROM chat_data.first_message_sightings WHERE user_id = ? ORDER BY seen_at ASC LIMIT 501',
			[user.id],
		);
		const truncated = rows.length > 500;
		const list = rows.slice(0, 500);
		const summary = summarize(list, 10);
		return res.json({
			login: name,
			userId: user.id,
			cached: false,
			truncated,
			count: summary?.count ?? 0,
			channels: summary?.channels ?? 0,
			firstSeen: summary?.firstSeen ?? null,
			lastSeen: summary?.lastSeen ?? null,
			topTexts: summary?.topTexts ?? [],
			sightings: list.map((i) => {
				const { kind, text } = splitKind(i.Normalized_Text);
				return { channel: i.Channel_Name, seenAt: i.Seen_At, kind, text };
			}),
		});
	});

	v1('/v1/live-chatters', async (req, res) => {
		const channel = lower(req.query.channel);
		if (!channel || !/^[a-z0-9_]{1,25}$/.test(channel)) {
			return res.status(400).json({ error: 'Missing or invalid: channel' });
		}
		const minutes = Math.min(Math.max(Number(one(req.query.minutes)) || 60, 1), 1440);
		const result = await findLiveChatters(
			{
				recentChatters,
				resolveIds: async (names) => {
					const out = {};
					for (const name of names) {
						const user = await fetchTwitchUser(name).catch(() => null);
						if (user) {
							out[name.toLowerCase()] = user.id;
						}
					}
					return out;
				},
				liveStreams: async (ids) => {
					const out = [];
					for (let i = 0; i < ids.length; i += 100) {
						const response = await got('Helix')({
							url: 'streams',
							searchParams: new URLSearchParams([...ids.slice(i, i + 100).map((id) => ['user_id', id]), ['first', '100']]),
						});
						for (const s of response.ok ? response.body.data : []) {
							out.push({
								userId: s.user_id,
								login: s.user_login,
								game: s.game_name ?? null,
								viewers: s.viewer_count ?? 0,
								startedAt: s.started_at ?? null,
								title: s.title ?? null,
							});
						}
					}
					return out;
				},
				monitored: async (login) => await getMonitoredStatus(login),
			},
			channel,
			{ minutes, onlyUnmonitored: one(req.query.onlyUnmonitored) === 'true' },
		);
		return res.json(result);
	});

	v1('/v1/twitch/user', async (req, res) => {
		const login = lower(req.query.login);
		if (!login) {
			return res.status(400).json({ error: 'Missing: login' });
		}
		const [user, ban] = await Promise.all([getUserProfile(login), banStatus(login).catch(() => null)]);
		if (!user && !ban) {
			return res.status(404).json({ error: 'User not found' });
		}
		return res.json({
			login: user?.login || login,
			displayName: user?.displayName || login,
			id: user?.id || null,
			banned: ban ? ban.banned : (user?.banned ?? false),
			banReason: ban?.banned ? ban.banReason : (user?.banReason ?? null),
			createdAt: user?.createdAt || null,
			updatedAt: null,
			followers: user?.followers ?? null,
			bio: user?.bio || null,
			roles: user?.roles || null,
			chatColor: user?.chatColor || null,
			emotePrefix: null,
			lastBroadcast: user?.lastBroadcast || null,
			stream: user?.stream || null,
			chatSettings: null,
		});
	});

	v1('/v1/twitch/banstatus', async (req, res) => {
		const login = lower(req.query.login);
		if (!login) {
			return res.status(400).json({ error: 'Missing: login' });
		}
		const result = await banStatus(login).catch(() => null);
		if (!result) {
			return res.status(503).json({ error: 'GQL unavailable' });
		}
		return res.json({ login, banned: result.banned, banReason: result.banned ? result.banReason : null, source: 'twitch-gql' });
	});

	v1('/v1/twitch/stream', async (req, res) => {
		const login = lower(req.query.login);
		if (!login) {
			return res.status(400).json({ error: 'Missing: login' });
		}

		const data = await gqlPublic(`{
			userResultByLogin(login: ${JSON.stringify(login)}) {
				__typename
				... on User { id login displayName stream { id type viewersCount createdAt title game { id name } } }
			}
		}`);
		const result = data?.userResultByLogin;
		if (!result || result.__typename !== 'User') {
			return res.json({ login, live: false });
		}
		const s = result.stream;
		if (!s) {
			return res.json({ login, live: false, id: result.id, displayName: result.displayName });
		}
		return res.json({
			login: result.login,
			displayName: result.displayName,
			id: result.id,
			live: true,
			streamId: s.id,
			type: s.type,
			title: s.title,
			viewer_count: s.viewersCount,
			game_id: s.game?.id || null,
			game_name: s.game?.name || null,
			started_at: s.createdAt,
		});
	});

	v1('/v1/twitch/modvip', async (req, res) => {
		const channel = lower(req.query.channel);
		if (!channel) {
			return res.status(400).json({ error: 'Missing: channel' });
		}

		const fetchAll = async (field) => {
			const items = [];
			let cursor = null;
			do {
				const after = cursor ? `, after: ${JSON.stringify(cursor)}` : '';
				const data = await gqlPublic(`{
					user(login: ${JSON.stringify(channel)}) {
						${field}(first: 100${after}) { edges { node { id login displayName } grantedAt } pageInfo { hasNextPage endCursor } }
					}
				}`);
				const conn = data?.user?.[field];
				if (!conn) {
					break;
				}
				items.push(...conn.edges);
				cursor = conn.pageInfo.hasNextPage ? conn.pageInfo.endCursor : null;
			} while (cursor);
			return items;
		};
		const [mods, vips] = await Promise.all([fetchAll('mods'), fetchAll('vips')]);
		const map = (list) => list.map((i) => ({ id: i.node.id, login: i.node.login, displayName: i.node.displayName, grantedAt: i.grantedAt }));
		return res.json({ mods: map(mods), vips: map(vips) });
	});

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
	v1('/v1/twitch/subage', async (req, res) => await subAndFollow(req, res, true));
	v1('/v1/twitch/subfollowage', async (req, res) => await subAndFollow(req, res, false));

	v1('/v1/twitch/logs', async (req, res) => {
		const channel = lower(req.query.channel);
		const user = lower(req.query.user) || null;
		const limit = Math.min(Number.parseInt(one(req.query.limit), 10) || 100, 500);
		if (!channel) {
			return res.status(400).json({ error: 'Missing: channel' });
		}
		const logs = await chatLogs(channel, { limit, user });
		return res.json({ channel, user, count: logs.length, logs });
	});

	v1('/v1/bot/modactions', async (req, res) => {
		const channel = lower(req.query.channel);
		const user = lower(req.query.user);
		const limit = Math.min(Number.parseInt(one(req.query.limit), 10) || 50, 200);

		const docs = await bot.DB.ModerationBanLog.find({ ...(channel ? { channelName: channel } : {}), ...(user ? { username: user } : {}) })
			.sort({ created: -1 })
			.limit(limit)
			.lean();
		const rows = docs.map((i) => ({
			id: i._id,
			username: i.username,
			user_id: i.userId,
			channel: i.channelName,
			type: i.type,
			duration: i.duration,
			reason: i.reason,
			status: i.status,
			mod_name: i.modName,
			automated: i.automated ? 1 : 0,
			banned_at: i.created,
		}));
		return res.json({ count: rows.length, actions: rows });
	});

	v1('/v1/bot/banwatch', async (req, res) => {
		const channelName = lower(req.query.channel);
		const channel = channelName ? bot.Channels.get(channelName) : null;
		const rows = (await bot.DB.NotifyBan.find(channelName ? { channel: channel?.id ?? 0 } : {}).lean()).map((i) => ({
			Channel: i.channel,
			Login: i.login,
			Message: i.message,
			Notified: i.notified,
		}));
		const banwatch = rows.map((i) => ({ channel: bot.Channels.get(i.Channel)?.Name ?? null, login: i.Login, message: i.Message, notified_at: i.Notified }));
		return res.json({ count: banwatch.length, banwatch });
	});

	v1('/v1/bot/channels', async (_req, res) => {
		const twitch = bot.Twitch;
		const all = [...bot.Channels.all()].filter((i) => i.Platform === twitch);
		const joined = all
			.filter((i) => i.Mode !== 'Inactive')
			.map((i) => i.Name)
			.sort();
		const parted = all
			.filter((i) => i.Mode === 'Inactive')
			.map((i) => i.Name)
			.sort();
		return res.json({ joined: joined.length, parted: parted.length, channels: joined, partedChannels: parted });
	});

	v1('/v1/bot/status', async (_req, res) => {
		const twitch = bot.Twitch;
		const all = [...bot.Channels.all()].filter((i) => i.Platform === twitch);
		const ps = pubsub.status();
		return res.json({
			uptime: Math.floor(process.uptime()),
			channels: { irc: null, eventsub: all.filter((i) => i.Mode !== 'Inactive').length, parted: all.filter((i) => i.Mode === 'Inactive').length },
			pubsub: { connections: ps.connections, topics: ps.topics },
			memory: Math.round(process.memoryUsage().rss / 1024 / 1024),
			node: process.version,
		});
	});

	// sb-v2 fuehrte eine eigene Namenshistorie (username_history); hier ueber CatQuery wie !names
	v1('/v1/bot/userhistory', async (req, res) => {
		const login = lower(req.query.login);
		if (!login) {
			return res.status(400).json({ error: 'Missing: login' });
		}
		const names = await getKnownNames(login).catch(() => []);
		if (names.length === 0) {
			return res.status(404).json({ error: 'User not found in history' });
		}
		return res.json({
			userId: names[0].user_id,
			history: names.map((i) => ({ username: i.name, first_seen: i.first_timestamp, last_seen: i.last_timestamp })),
		});
	});

	v1('/v1/twitch/chatters', async (req, res) => {
		const channel = lower(req.query.channel);
		if (!channel) {
			return res.status(400).json({ error: 'Missing: channel' });
		}
		const user = await fetchTwitchUser(channel);
		if (!user) {
			return res.status(404).json({ error: 'Channel nicht gefunden' });
		}
		const limit = Math.min(Number.parseInt(one(req.query.limit), 10) || 1000, 1000);
		const result = await fetchChatters(user.id, bot.Twitch.selfId);
		if (result.forbidden) {
			return res.status(500).json({ error: 'Request failed with status code 403' });
		}
		return res.json({ count: result.total, chatters: result.names.slice(0, limit) });
	});

	v1('/v1/twitch/recentmessages', async (req, res) => {
		const channel = lower(req.query.channel);
		if (!channel) {
			return res.status(400).json({ error: 'Missing: channel' });
		}
		const limit = Math.min(Number.parseInt(one(req.query.limit), 10) || 100, 500);
		const rows = await chatLogs(channel, { limit });
		return res.json({
			channel,
			messages: rows.map((i) => ({ id: i.id, username: i.username, userId: i.user_id, message: i.message, timestamp: i.created_at })),
		});
	});

	v1('/v1/twitch/clip', async (req, res) => {
		const slug = one(req.query.slug);
		if (!slug) {
			return res.status(400).json({ error: 'Missing: slug' });
		}

		const data = await helix('clips', { id: slug });
		const c = data.data[0];
		if (!c) {
			return res.status(404).json({ error: 'Clip nicht gefunden' });
		}
		return res.json({
			id: c.id,
			slug: c.id,
			title: c.title,
			broadcaster: { id: c.broadcaster_id, login: c.broadcaster_name.toLowerCase(), displayName: c.broadcaster_name },
			creator: { id: c.creator_id, login: c.creator_name },
			game: { id: c.game_id },
			viewCount: c.view_count,
			duration: c.duration,
			createdAt: c.created_at,
			thumbnailUrl: c.thumbnail_url,
			url: c.url,
		});
	});

	v1('/v1/twitch/game', async (req, res) => {
		const name = one(req.query.name);
		const id = one(req.query.id);
		if (!name && !id) {
			return res.status(400).json({ error: 'Missing: name oder id' });
		}
		const data = await helix('games', id ? { id } : { name });
		const g = data.data[0];
		if (!g) {
			return res.status(404).json({ error: 'Spiel nicht gefunden' });
		}
		return res.json({ id: g.id, name: g.name, boxArtUrl: g.box_art_url });
	});

	v1('/v1/twitch/userbadges', async (req, res) => {
		const login = lower(req.query.login);
		if (!login) {
			return res.status(400).json({ error: 'Missing: login' });
		}
		const data = await gqlPublic(`{
			user(login: ${JSON.stringify(login)}) { broadcastBadges { setID version title description imageURL(size: QUADRUPLE) clickURL clickAction } }
		}`);
		return res.json({ login, badges: data?.user?.broadcastBadges ?? [] });
	});

	v1('/v1/twitch/pinnedmessage', async (req, res) => {
		const channel = lower(req.query.channel);
		if (!channel) {
			return res.status(400).json({ error: 'Missing: channel' });
		}
		const data = await gqlPublic(`{
			user(login: ${JSON.stringify(channel)}) { channel { pinnedChatMessages(first: 1) { edges { node { id type updatedAt } } } } }
		}`);
		return res.json({ channel, pinnedMessage: data?.user?.channel?.pinnedChatMessages?.edges[0]?.node ?? null });
	});

	v1('/v1/twitch/founders', async (req, res) => {
		const channel = one(req.query.channel);
		if (!channel) {
			return res.status(400).json({ error: 'Missing: channel' });
		}
		return res.json(await tackling('/twitch/Founders', { login: channel }));
	});

	v1('/v1/twitch/userfollowers', async (req, res) => {
		const login = lower(req.query.login);
		if (!login) {
			return res.status(400).json({ error: 'Missing: login' });
		}
		const n = Math.min(Number.parseInt(one(req.query.limit), 10) || 20, 100);

		const data = await gqlPublic(`{
			user(login: ${JSON.stringify(login)}) { followers(first: ${n}) { totalCount edges { followedAt node { login displayName } } } }
		}`);
		const f = data?.user?.followers;
		if (!f) {
			return res.status(404).json({ error: 'User nicht gefunden' });
		}
		return res.json({
			login,
			totalCount: f.totalCount,
			followers: f.edges.filter((i) => i.node).map((i) => ({ login: i.node?.login, displayName: i.node?.displayName, followedAt: i.followedAt })),
		});
	});

	// Mit Nutzer-Token (oder als Bot-Konto) ueber Helix, sonst tackling.cc
	v1('/v1/twitch/userfollows', async (req, res) => {
		const login = lower(req.query.login);
		const limit = Math.min(Number.parseInt(one(req.query.limit), 10) || 100, 500);
		if (!login) {
			return res.status(400).json({ error: 'Missing: login' });
		}
		const user = await fetchTwitchUser(login).catch(() => null);
		if (user) {
			const isBot = login === bot.Twitch.selfName;
			const token = isBot ? null : await getValidToken(login).catch(() => null);
			if (isBot || token) {
				const follows = [];
				let total = 0;
				let cursor;
				do {
					const searchParams = { user_id: user.id, first: 100, ...(cursor ? { after: cursor } : {}) };
					const response = token
						? await helixAsUser(token, { url: 'channels/followed', searchParams })
						: await got('Helix')({ url: 'channels/followed', searchParams });
					if (!response.ok) {
						break;
					}
					total = response.body.total;
					for (const f of response.body.data) {
						if (follows.length >= limit) {
							break;
						}
						follows.push({ id: f.broadcaster_id, login: f.broadcaster_login, displayName: f.broadcaster_name, followedAt: f.followed_at });
					}
					cursor = follows.length < limit ? response.body.pagination?.cursor : undefined;
				} while (cursor);
				return res.json({ login: user.login, displayName: user.display_name, id: user.id, totalCount: total, follows, source: 'helix-direct' });
			}
		}
		const data = await tackling('/twitch/UserFollows', { login });
		return res.json({ ...data, source: 'tackling-fallback' });
	});

	v1('/v1/twitch/team', async (req, res) => {
		const team = lower(req.query.team);
		if (!team) {
			return res.status(400).json({ error: 'Missing: team' });
		}

		const data = await gqlPublic(`{
			team(name: ${JSON.stringify(team)}) {
				id name displayName description
				members(first: 100) { edges { node { login displayName profileImageURL(width: 70) } } }
			}
		}`);
		const t = data?.team;
		if (!t) {
			return res.status(404).json({ error: 'Team nicht gefunden' });
		}
		return res.json({
			id: t.id,
			name: t.name,
			displayName: t.displayName,
			description: t.description,
			members: t.members.edges
				.filter((i) => i.node)
				.map((i) => ({ login: i.node?.login, displayName: i.node?.displayName, logo: i.node?.profileImageURL })),
		});
	});

	v1('/v1/twitch/usernameavailable', async (req, res) => {
		const username = one(req.query.username);
		if (!username) {
			return res.status(400).json({ error: 'Missing: username' });
		}
		return res.json(await tackling('/twitch/UsernameAvailable', { username }));
	});

	v1('/v1/twitch/topstreams', async (req, res) => {
		const n = Math.min(Number.parseInt(one(req.query.limit), 10) || 20, 100);

		const data = await gqlPublic(`{
			streams(first: ${n}) {
				edges { node { id title type viewersCount createdAt game { id name } broadcaster { login displayName profileImageURL(width: 70) } } }
			}
		}`);
		return res.json(
			(data?.streams?.edges ?? []).map(({ node }) => ({
				id: node.id,
				title: node.title,
				type: node.type,
				viewers: node.viewersCount,
				startedAt: node.createdAt,
				game: node.game ? { id: node.game.id, name: node.game.name } : null,
				broadcaster: { login: node.broadcaster?.login, displayName: node.broadcaster?.displayName, logo: node.broadcaster?.profileImageURL },
			})),
		);
	});

	v1('/v1/7tv/user', async (req, res) => {
		const login = lower(req.query.login);
		if (!login) {
			return res.status(400).json({ error: 'Missing: login' });
		}
		const user = await fetchTwitchUser(login);
		if (!user) {
			return res.status(404).json({ error: 'Twitch-User nicht gefunden' });
		}
		const response = await got('Global')({ url: `https://7tv.io/v3/users/twitch/${user.id}`, responseType: 'json', timeout: { request: 8000 } });
		if (response.statusCode === 404) {
			return res.status(404).json({ error: '7TV-User nicht gefunden' });
		}
		return res.json(response.body);
	});

	router.delete(
		'/v1/twitch/blockedterm',
		requireApiKey,
		route(async (req, res) => {
			const body = req.body ?? {};
			const channel = lower(one(req.query.channel) || body.channel);
			const termId = one(req.query.id) || one(body.id);
			if (!channel || !termId) {
				return res.status(400).json({ error: 'Missing: channel, id' });
			}
			const user = await fetchTwitchUser(channel);
			if (!user) {
				return res.status(404).json({ error: 'Channel nicht gefunden' });
			}
			const twitch = bot.Twitch;
			const response = await got('Helix')({
				method: 'DELETE',
				url: 'moderation/blocked_terms',
				searchParams: { broadcaster_id: user.id, moderator_id: twitch.selfId, id: termId },
				responseType: 'text',
			});
			if (response.statusCode === 401) return res.status(401).json({ error: 'Bot-Token ungültig' });
			if (response.statusCode === 403) return res.status(403).json({ error: 'Bot ist kein Mod in diesem Channel' });
			if (response.statusCode === 404) return res.status(404).json({ error: 'Term nicht gefunden' });
			if (!response.ok) return res.status(500).json({ error: `Request failed with status code ${response.statusCode}` });
			return res.json({ success: true, channel, id: termId });
		}),
	);

	/* ---------- oeffentliche Bot-Liste (chat_data.known_bots, gepflegt vom autojoin-bot) ---------- */

	router.get(
		'/v1/public/bots',
		route(async (req, res) => {
			const limit = Math.min(Number.parseInt(one(req.query.limit) || '1000', 10), 10_000);
			const offset = Number.parseInt(one(req.query.offset) || '0', 10) || 0;
			const bots = await sbv2.query('SELECT user_id, login, source, added_at FROM chat_data.known_bots ORDER BY added_at DESC LIMIT ? OFFSET ?', [
				limit,
				offset,
			]);
			const total = (await sbv2.query('SELECT COUNT(*) AS c FROM chat_data.known_bots'))[0]?.c ?? 0;
			return res.json({ total: Number(total), limit, offset, bots });
		}),
	);
	router.get(
		'/v1/public/bots/stats',
		route(async (_req, res) => {
			const rows = await sbv2.query(
				"SELECT COUNT(*) AS total, SUM(CASE WHEN source LIKE '%viewbot%' THEN 1 ELSE 0 END) AS viewbots, SUM(CASE WHEN source LIKE '%followbot%' THEN 1 ELSE 0 END) AS followbots FROM chat_data.known_bots",
			);
			return res.json({ total: Number(rows[0]?.total ?? 0), viewbots: Number(rows[0]?.viewbots ?? 0), followbots: Number(rows[0]?.followbots ?? 0) });
		}),
	);
	router.get(
		'/v1/public/bots/:login',
		route(async (req, res) => {
			const login = String(req.params.login).toLowerCase().trim();
			const rows = await sbv2.query('SELECT user_id, login, source, added_at FROM chat_data.known_bots WHERE login = ? OR user_id = ?', [login, login]);
			if (rows.length === 0) {
				return res.status(404).json({ known_bot: false });
			}
			return res.json({ known_bot: true, ...rows[0] });
		}),
	);
	router.post(
		'/v1/bots',
		(req, res, next) => {
			const token = one(req.query.token) || (req.headers.authorization ?? '').replace('Bearer ', '').trim();
			const expected = process.env.WEB_BOTLIST_UPLOAD_TOKEN;
			if (!token || !expected || token !== expected) {
				res.status(401).json({ error: 'Unauthorized' });
				return;
			}
			next();
		},
		route(async (req, res) => {
			const bots = Array.isArray(req.body) ? req.body : [req.body];
			let added = 0;
			// "entry" statt "bot": "bot" ist hier das globale Bot-Objekt
			for (const entry of bots) {
				if (!entry.login) {
					continue;
				}
				// chat_data.known_bots gehoert dem autojoin-bot (geteilte sb-v2-Daten in MariaDB)
				await sbv2.query(
					'INSERT INTO chat_data.known_bots (login, user_id, source) VALUES (?, ?, ?) ON DUPLICATE KEY UPDATE user_id = COALESCE(VALUES(user_id), user_id), source = COALESCE(VALUES(source), source)',
					[entry.login.toLowerCase(), entry.user_id ? String(entry.user_id) : null, entry.source ?? null],
				);
				added++;
			}
			return res.json({ success: true, added });
		}),
	);

	router.get(
		'/public/twitch/user',
		publicRateLimit,
		route(async (req, res) => {
			const login = lower(req.query.login);
			if (!login) {
				return res.status(400).json({ error: 'Missing: login' });
			}
			const [user, reasons] = await Promise.all([getUserProfile(login), getChatRestrictedReasons(login)]);
			if (!user || (user.banned && user.banReason === 'UNKNOWN' && !user.id)) {
				return res.status(404).json({ error: 'User not found' });
			}
			if (user.banned) {
				return res.json({
					login: user.login,
					displayName: user.displayName,
					id: user.id,
					banned: true,
					banReason: user.banReason,
					createdAt: user.createdAt,
					updatedAt: null,
				});
			}
			return res.json({
				login: user.login,
				displayName: user.displayName,
				id: user.id,
				banned: false,
				banReason: null,
				chatDisabled: reasons?.includes('CHANNEL_HAS_CONSEQUENCE') ?? false,
				createdAt: user.createdAt,
				updatedAt: null,
				followers: user.followers,
				bio: user.bio,
				chatColor: user.chatColor,
				roles: user.roles,
				lastBroadcast: user.lastBroadcast,
				stream: user.stream,
				chatSettings: null,
			});
		}),
	);

	return router;
};

module.exports = { isValidApiKey, bearerToken, createV1Router };
