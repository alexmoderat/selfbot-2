const { Logger } = require('../misc/logger.js');
const { got } = require('./got.js');
const { fetchTwitchUser } = require('../util/twitch/twitch-utils.js');
const { gqlSmartbox } = require('./gql.js');

// Chatter-, Follower- und Account-Abfragen ueber Helix, aus sb-v2s v2/utils/twitch-lists.ts.
// /chat/chatters braucht moderator:read:chatters (nur wo der Bot moddet, sonst 403);
// /channels/followers liefert die Gesamtzahl auch ohne Mod-Rechte.

const CHATTER_PAGE_SIZE = 1000; // Helix-Maximum
const CHATTERS_CAP = 20_000;

/** Chatterliste eines Channels; forbidden = keine Rechte (nicht Mod / Scope fehlt) */
const fetchChatters = async (broadcasterId, moderatorId) => {
	const names = [];
	const users = [];
	let total = 0;
	let cursor;
	do {
		const response = await got('Helix')({
			url: 'chat/chatters',
			searchParams: {
				broadcaster_id: broadcasterId,
				moderator_id: moderatorId,
				first: CHATTER_PAGE_SIZE,
				...(cursor ? { after: cursor } : {}),
			},
		});

		if (response.statusCode === 403) {
			return { total: 0, names: [], users: [], forbidden: true };
		} else if (!response.ok) {
			throw new Error(`Helix chat/chatters: ${response.statusCode}`);
		}

		total = response.body.total ?? total;
		for (const row of response.body.data) {
			names.push(row.user_login);
			users.push({ id: row.user_id, login: row.user_login });
		}

		cursor = response.body.pagination?.cursor;
	} while (cursor && names.length < CHATTERS_CAP);

	return { total: total || names.length, names, users, forbidden: false };
};

/**
 * Nur die Follower-Gesamtzahl, eine Seite statt der vollen Liste (fuer new-account-followers-guard).
 * null bei Fehler - der Aufrufer soll das ignorieren, nicht als 0 werten.
 */
const fetchFollowerCount = async (userId) => {
	const response = await got('Helix')({
		url: 'channels/followers',
		searchParams: { broadcaster_id: userId, first: 1 },
	});

	return response.ok && typeof response.body.total === 'number' ? response.body.total : null;
};

/** Alter eines Accounts in Tagen; null, wenn nicht ermittelbar */
const accountAgeDays = async (identifier, options = {}) => {
	const user = await fetchTwitchUser(identifier, options).catch((e) => {
		Logger.warn(`[twitch-lists] Altersabfrage fehlgeschlagen fuer ${identifier}`, e);
		return null;
	});

	if (!user?.created_at) {
		return null;
	}

	return { id: user.id, ageDays: (Date.now() - Date.parse(user.created_at)) / 86_400_000 };
};

/** Thumbnail-URL des laufenden Streams (440x248) oder null, wenn nicht live */
const fetchStreamThumbnailUrl = async (userId) => {
	const response = await got('Helix')({
		url: 'streams',
		searchParams: { user_id: userId },
	});

	const url = response.ok ? response.body.data[0]?.thumbnail_url : null;
	return url ? url.replace('{width}', '440').replace('{height}', '248') : null;
};

/**
 * Alle Emotes, die ein Account nutzen kann (Supibots TwitchPlatform.fetchTwitchEmotes, Helix chat/emotes/user,
 * Scope user:read:emotes) - fuer botsubs
 */
const fetchUserEmotes = async (userId) => {
	const result = [];
	let cursor;
	do {
		const response = await got('Helix')({
			url: 'chat/emotes/user',
			searchParams: { user_id: userId, ...(cursor ? { after: cursor } : {}) },
		});

		if (!response.ok) {
			throw new Error(`Helix chat/emotes/user: ${response.statusCode}`);
		}

		result.push(...response.body.data);
		cursor = response.body.pagination?.cursor;
	} while (cursor);

	return result;
};

const FOLLOWERS_CAP = 10_000;
const FOLLOWER_PAGE_SIZE = 100;

/**
 * Follower eines Channels (neueste zuerst, aus sb-v2s fetchFollowers): Gesamtzahl gibt es immer, die Namen nur,
 * wo der Bot moddet - ohne Rechte bleibt names leer. null, wenn es den Account nicht gibt.
 */
const fetchFollowers = async (login) => {
	const user = await fetchTwitchUser(login);
	if (!user) {
		return null;
	}

	const names = [];
	let total = 0;
	let cursor;
	do {
		const response = await got('Helix')({
			url: 'channels/followers',
			searchParams: { broadcaster_id: user.id, first: FOLLOWER_PAGE_SIZE, ...(cursor ? { after: cursor } : {}) },
		});
		if (!response.ok) {
			throw new Error(`Helix channels/followers: ${response.statusCode}`);
		}

		total = response.body.total ?? total;
		names.push(...response.body.data.map((i) => i.user_login));
		cursor = response.body.pagination?.cursor;
	} while (cursor && names.length < FOLLOWERS_CAP);

	return { total, names: names.slice(0, FOLLOWERS_CAP) };
};

/** Chatterliste per SmartBox-GQL fuer Channels ohne Mod-Rechte (sb-v2s fetchChattersGql); null ohne Daten */
const fetchChattersGql = async (channel) => {
	const data = await gqlSmartbox(`
		query {
			user(login: ${JSON.stringify(channel)}) {
				channel {
					chatters {
						count
						viewers { login }
						vips { login }
						moderators { login }
						broadcasters { login }
						staff { login }
					}
				}
			}
		}
	`).catch(() => null);

	const chatters = data?.user?.channel?.chatters;
	if (!chatters) {
		return null;
	}

	const names = [...chatters.viewers, ...chatters.vips, ...chatters.moderators, ...chatters.broadcasters, ...chatters.staff].map((i) => i.login).slice(0, CHATTERS_CAP);

	return { total: chatters.count ?? names.length, names, users: [], forbidden: false };
};

module.exports = {
	CHATTERS_CAP,
	fetchChatters,
	fetchFollowerCount,
	accountAgeDays,
	fetchStreamThumbnailUrl,
	fetchUserEmotes,
	FOLLOWERS_CAP,
	fetchFollowers,
	fetchChattersGql,
};
