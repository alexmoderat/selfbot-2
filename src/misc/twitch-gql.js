const { got } = require('../token/got.js');
const { SupiError } = require('./error.js');
const { gqlPostWithFingerprint } = require('./fingerprint-client.js');

// Twitch-GQL wie in sb-v2 (src/services/twitch-api.ts): oeffentlich ohne Login (gqlPublic) und mit dem
// Web-Session-Token von alexmoderat (TWITCH_WEB_TOKEN) fuer Felder/Mutationen, die anonym nicht gehen.

const GQL_PUBLIC_CLIENT_ID = 'kimne78kx3ncx6brgo4mv6wki5h1ko';
const GQL_URL = 'https://gql.twitch.tv/gql';

const gqlPublic = async (query) => {
	const response = await got('Global')({
		method: 'POST',
		url: GQL_URL,
		headers: { 'Client-Id': GQL_PUBLIC_CLIENT_ID },
		json: { query },
		timeout: { request: 6000 },
	});

	return response.body.data ?? null;
};

/** Mit Web-Token; ohne TWITCH_WEB_TOKEN Fehler, GQL-Fehler werden geworfen (ein 200 ist kein Erfolg) */
const gqlAuth = async (body) => {
	const token = process.env.TWITCH_WEB_TOKEN;
	if (!token) {
		throw new SupiError({ message: 'webToken not configured' });
	}

	const response = await got('Global')({
		method: 'POST',
		url: GQL_URL,
		headers: { 'Client-Id': GQL_PUBLIC_CLIENT_ID, Authorization: `OAuth ${token}` },
		json: body,
		timeout: { request: 8000 },
	});

	if (response.body.errors?.length) {
		throw new SupiError({ message: response.body.errors[0]?.message ?? 'GQL error' });
	} else if (!response.body.data) {
		throw new SupiError({ message: `GQL request failed (${response.statusCode})` });
	}

	return response.body.data;
};

/** User per oeffentlichem GQL inkl. Sperr-Status (gesperrte Accounts liefern UserDoesNotExist + Grund) */
const getUserInfo = async (username) => {
	const login = username.toLowerCase().trim();
	const data = await gqlPublic(`{
		userResultByLogin(login: ${JSON.stringify(login)}) {
			__typename
			... on User { id login displayName }
			... on UserDoesNotExist { reason }
		}
	}`);

	const result = data?.userResultByLogin;
	if (!result) {
		return null;
	}

	if (result.__typename === 'UserDoesNotExist') {
		// user(lookupType: ALL) liefert trotz Sperre noch die ID (in sb-v2 per curl verifiziert, 01.09.2026)
		const fallback = await gqlPublic(`{ user(login: ${JSON.stringify(login)}, lookupType: ALL) { id } }`).catch(() => null);
		return {
			login,
			displayName: login,
			id: fallback?.user?.id ?? null,
			banned: true,
			banReason: result.reason || 'UNKNOWN',
		};
	}

	return { login: result.login, displayName: result.displayName, id: result.id, banned: false, banReason: null };
};

/**
 * Live-Stream eines Accounts als Bot bei Twitch melden ("fake_live" aus !report: spam/bots, LIVESTREAM_REPORT) -
 * fuer die Fake-Live-Erkennung (alexmoderat, 30.09.2026: "das ist auch schon ToS also ganz ehrlich just chatting
 * aber was anderes zeigen"). Ohne TWITCH_WEB_TOKEN wirft gqlAuth.
 */
const reportFakeLive = async (userId, comment) => {
	const sessionId = Array.from({ length: 32 }, () => Math.floor(Math.random() * 16).toString(16)).join('');
	const mutation = `
		mutation ReportWizard_CreateReport {
			reportUserContent(input: {
				content: LIVESTREAM_REPORT,
				contentMetadata: { channelID: ${JSON.stringify(userId)} },
				description: ${JSON.stringify(comment)},
				detailedReason: "bots",
				dsaArgs: { reporterEmail: "" },
				reason: "spam",
				sessionID: ${JSON.stringify(sessionId)},
				targetUserID: ${JSON.stringify(userId)},
				uiEntryPoint: "moderation_user_details"
			}) {
				error { __typename }
			}
		}`;

	const data = await gqlAuth({ query: mutation, variables: {} });
	return data.reportUserContent?.error?.__typename ?? null;
};

// Twitch begrenzt die Root-Aliase pro Query - mehr als 15 brachen in sb-v2 die ganze Antwort ab
const GQL_ROOT_ALIAS_LIMIT = 15;

/**
 * Sperr-Status vieler Logins in einem GQL-Batch, aus sb-v2s getBanStatusBatch (ban-check, checksuspended).
 * Eine fehlgeschlagene Gruppe wirft: ein Teilergebnis liesse ban-check fehlende Channels als "nicht gefunden" zaehlen.
 * Nur "User" und "UserDoesNotExist" sind verlaessliche Signale - alles andere (sporadisch "UserError" fuer normale
 * Accounts, 27.08.2026) fehlt in der Map, statt als Ban oder Entwarnung gewertet zu werden.
 */
const getBanStatusBatch = async (logins) => {
	const result = new Map();
	const clean = logins.map((i) => i.toLowerCase().trim());
	const groups = [];
	for (let i = 0; i < clean.length; i += GQL_ROOT_ALIAS_LIMIT) {
		groups.push(clean.slice(i, i + GQL_ROOT_ALIAS_LIMIT));
	}
	if (groups.length === 0) {
		return result;
	}

	const body = groups.map((group) => ({
		query: `{ ${group.map((login, i) => `c${i}: userResultByLogin(login: ${JSON.stringify(login)}) { __typename ... on UserDoesNotExist { reason } ... on User { id } }`).join('\n')} }`,
	}));

	const response = await got('Global')({
		method: 'POST',
		url: GQL_URL,
		headers: { 'Client-Id': GQL_PUBLIC_CLIENT_ID },
		json: body,
		timeout: { request: 10_000 },
	}).catch((e) => ({ ok: false, statusCode: 0, body: null, error: e }));

	let answers = Array.isArray(response.body) ? response.body : [];
	let failed = groups.findIndex((_group, index) => !answers[index]?.data);
	if (!response.ok || failed !== -1) {
		// Fallback ueber Chrome-TLS-Fingerprint (sb-v2: gqlPostWithFingerprint); ohne gebautes Addon wirft der Aufruf sofort
		// und der Fehler bleibt wie zuvor
		try {
			const viaChrome = await gqlPostWithFingerprint(body, GQL_PUBLIC_CLIENT_ID);
			const chromeAnswers = Array.isArray(viaChrome) ? viaChrome : [];
			if (groups.every((_group, index) => chromeAnswers[index]?.data)) {
				console.warn('[twitch-gql] getBanStatusBatch: Standard-Request blockiert, Chrome-Fingerprint-Fallback erfolgreich');
				answers = chromeAnswers;
				failed = -1;
			}
		} catch {
			// Fallback nicht verfuegbar oder ebenfalls fehlgeschlagen
		}
	}
	if (failed !== -1) {
		throw new SupiError({
			message: `getBanStatusBatch: ${answers[failed]?.errors?.[0]?.message ?? response.error?.message ?? `HTTP ${response.statusCode}`}`,
		});
	}

	groups.forEach((group, groupIndex) => {
		const data = answers[groupIndex].data;
		group.forEach((login, i) => {
			const entry = data[`c${i}`];
			if (entry?.__typename === 'UserDoesNotExist') {
				result.set(login, { banned: true, banReason: entry.reason || 'UNKNOWN' });
			} else if (entry?.__typename === 'User') {
				result.set(login, { banned: false, banReason: null });
			}
		});
	});

	return result;
};

/**
 * GQL ueber die SmartBox-Client-Id mit eigenem Token (SMARTBOX_GQL_CLIENT_ID/SMARTBOX_GQL_TOKEN), aus sb-v2s gqlSmartbox -
 * schaltet Felder frei, die anonym gesperrt sind (subage, chatters ohne Mod, Editor-Weg). null ohne Konfiguration.
 */
const gqlSmartbox = async (query) => {
	const clientId = process.env.SMARTBOX_GQL_CLIENT_ID;
	const token = process.env.SMARTBOX_GQL_TOKEN;
	if (!clientId || !token) {
		return null;
	}

	const response = await got('Global')({
		method: 'POST',
		url: GQL_URL,
		headers: { 'Client-Id': clientId, Authorization: `OAuth ${token}` },
		json: { query },
		timeout: { request: 6000 },
	});

	if (!response.ok) {
		throw new SupiError({ message: `SmartBox GQL failed (${response.statusCode})` });
	}

	return response.body.data ?? null;
};

/**
 * Ob ein Login-Name frei ist, wie Twitch es bei Registrierung/Umbenennung prueft - anonym blockt der Integrity-Check,
 * ueber SmartBox geht es (alexmoderat, 30.10.2026). Erfasst auch reservierte und zu kurze Namen, die keine User-Suche
 * findet. null, wenn die Abfrage nicht moeglich ist.
 */
const isUsernameAvailable = async (login) => {
	if (!/^\w+$/.test(login)) {
		return null;
	}

	const data = await gqlSmartbox(`{ isUsernameAvailable(username: "${login}") }`).catch(() => null);
	return data?.isUsernameAvailable ?? null;
};

/** Oeffentliches GQL mit einem Wiederholungsversuch nach 500 ms (wie sb-v2s gqlPublicRetry) */
const gqlPublicRetry = async (query, retries = 1) => {
	for (let attempt = 0; ; attempt++) {
		try {
			return await gqlPublic(query);
		} catch (e) {
			if (attempt >= retries) {
				throw e;
			}
			await new Promise((resolve) => setTimeout(resolve, 500));
		}
	}
};

/** Letzte Archiv-VODs (neueste zuerst); ein zweiter Versuch, wenn Twitch "videos" kurz leer liefert (sb-v2) */
const getRecentVods = async (login, limit = 20) => {
	let edges = [];
	for (let attempt = 0; attempt <= 1; attempt++) {
		const data = await gqlPublicRetry(`{
			user(login: ${JSON.stringify(login.toLowerCase())}) {
				videos(first: ${Math.trunc(limit)}, type: ARCHIVE, sort: TIME) {
					edges { node { id createdAt lengthSeconds game { displayName } } }
				}
			}
		}`);

		edges = data?.user?.videos?.edges ?? [];
		if (edges.length > 0 || data?.user?.videos !== null) {
			break;
		}
		await new Promise((resolve) => setTimeout(resolve, 500));
	}

	return edges.map((i) => ({ id: i.node.id, createdAt: i.node.createdAt, lengthSeconds: i.node.lengthSeconds, game: i.node.game?.displayName ?? null }));
};

/** Kategorie-Kapitel eines VODs (VIDEO_CHAPTER_MARKERS) - kein Helix-Gegenstueck */
const getVodGameMoments = async (videoId) => {
	const data = await gqlPublicRetry(`{
		video(id: ${JSON.stringify(videoId)}) {
			moments(momentRequestType: VIDEO_CHAPTER_MARKERS) { edges { node { durationMilliseconds description } } }
		}
	}`);

	return (data?.video?.moments?.edges ?? []).map((i) => ({ game: i.node.description, durationMs: i.node.durationMilliseconds }));
};

/** Start des letzten Streams laut Twitch (auch ohne VOD), ISO oder null */
const getLastBroadcastStart = async (login) => {
	const data = await gqlPublicRetry(`{ user(login: ${JSON.stringify(login.toLowerCase())}) { lastBroadcast { startedAt } } }`);
	return data?.user?.lastBroadcast?.startedAt ?? null;
};

/* ---------- Block 7: Twitch-Infos (aus sb-v2s src/services/twitch-api.ts) ---------- */

/**
 * Ausfuehrliches Profil per oeffentlichem GQL (sb-v2s getUserInfo) - fuer user/whois und bio.
 * Gesperrte Accounts: user(lookupType: ALL) liefert trotzdem id/createdAt/lastBroadcast (sb-v2, 01.09.2026).
 * null bei GQL-Fehler.
 */
const getUserProfile = async (username) => {
	const login = username.toLowerCase().trim();
	let data;
	try {
		data = await gqlPublic(`{
			userResultByLogin(login: ${JSON.stringify(login)}) {
				__typename
				... on User {
					id login displayName description createdAt chatColor
					profileImageURL(width: 300)
					bannerImageURL
					followers { totalCount }
					roles { isAffiliate isPartner isStaff isSiteAdmin isGlobalMod isExtensionsDeveloper }
					lastBroadcast { startedAt title }
					stream { type viewersCount createdAt title game { name } }
				}
				... on UserDoesNotExist { reason }
			}
		}`);
	} catch (e) {
		console.warn('[twitch-gql] getUserProfile fehlgeschlagen', e);
		return null;
	}

	const result = data?.userResultByLogin;
	if (!result) {
		return null;
	}

	if (result.__typename === 'UserDoesNotExist') {
		const fallback = await gqlPublic(`{ user(login: ${JSON.stringify(login)}, lookupType: ALL) {
			id createdAt lastBroadcast { startedAt title }
		} }`).catch(() => null);

		return {
			login,
			displayName: login,
			id: fallback?.user?.id ?? null,
			banned: true,
			banReason: result.reason || 'UNKNOWN',
			bio: null,
			createdAt: fallback?.user?.createdAt ?? null,
			chatColor: null,
			logo: null,
			banner: null,
			followers: null,
			roles: null,
			lastBroadcast: fallback?.user?.lastBroadcast ?? null,
			stream: null,
		};
	}

	return {
		login: result.login,
		displayName: result.displayName,
		id: result.id,
		banned: false,
		banReason: null,
		bio: result.description || null,
		createdAt: result.createdAt || null,
		chatColor: result.chatColor || null,
		logo: result.profileImageURL || null,
		banner: result.bannerImageURL || null,
		followers: result.followers?.totalCount ?? null,
		roles: {
			isAffiliate: result.roles?.isAffiliate ?? false,
			isPartner: result.roles?.isPartner ?? false,
			isStaff: result.roles?.isStaff ?? null,
			isSiteAdmin: result.roles?.isSiteAdmin ?? null,
			isGlobalMod: result.roles?.isGlobalMod ?? null,
			isExtensionsDeveloper: result.roles?.isExtensionsDeveloper ?? false,
		},
		lastBroadcast: result.lastBroadcast ?? null,
		stream: result.stream
			? {
					type: result.stream.type,
					viewer_count: result.stream.viewersCount,
					game_name: result.stream.game?.name ?? null,
					started_at: result.stream.createdAt,
					title: result.stream.title,
				}
			: null,
	};
};

/** Warum der Web-Token-Account im Channel nicht schreiben darf (z.B. CHANNEL_HAS_CONSEQUENCE); null ohne Token/bei Fehler */
const getChatRestrictedReasons = async (login) => {
	try {
		const data = await gqlAuth({
			query: `query ChannelHasConsequence($channelLogin: String!) {
				channel: user(login: $channelLogin) { id self { chatRestrictedReasons } }
			}`,
			variables: { channelLogin: login.toLowerCase().trim() },
		});
		return data.channel?.self?.chatRestrictedReasons ?? null;
	} catch {
		return null;
	}
};

const CHANNEL_POINTS_CONTEXT_HASH = '7fe050e3761eb2cf258d70ee1a21cbd76fa8cf3d7e7b12fc437e7029d446b5e3';

/** Kanalpunkte des Web-Token-Accounts in einem Channel (sb-v2s getChannelPointsBalance); null bei Fehler */
const getChannelPointsBalance = async (channelLogin) => {
	const token = process.env.TWITCH_WEB_TOKEN;
	if (!token) {
		return null;
	}

	const response = await got('Global')({
		method: 'POST',
		url: GQL_URL,
		headers: { 'Client-Id': GQL_PUBLIC_CLIENT_ID, Authorization: `OAuth ${token}` },
		json: [
			{
				operationName: 'ChannelPointsContext',
				variables: { channelLogin: channelLogin.toLowerCase().trim(), includeGoalTypes: ['CREATOR', 'BOOST'] },
				extensions: { persistedQuery: { version: 1, sha256Hash: CHANNEL_POINTS_CONTEXT_HASH } },
			},
		],
		timeout: { request: 8000 },
	}).catch(() => null);

	const balance = response?.body[0]?.data?.community?.channel?.self?.communityPoints?.balance;
	return typeof balance === 'number' ? balance : null;
};

const CHANNELS_WITH_ROLE_HASH = '46f9085d9c6295dc9ba6c7db1c61355c9c2ed6380048fc4e3d1f8fb3470f186b';

/**
 * Channels, in denen der Web-Token-Account eine Rolle hat (Dashboard "My Assigned Roles"; roleId z. B. "lead_mod").
 * Die Abfrage gilt immer fuer den Token-Besitzer, nicht fuer andere User. -> { userId, logins } oder null
 */
const getChannelsWithRole = async (roleId = 'lead_mod') => {
	const data = await gqlAuth({ operationName: 'ChannelsWithRole', variables: { roleId }, extensions: { persistedQuery: { version: 1, sha256Hash: CHANNELS_WITH_ROLE_HASH } } });
	const user = data?.currentUser;
	const edges = user?.channelsWithRole?.edges;
	if (!Array.isArray(edges)) {
		return null;
	}

	return { userId: String(user.id), logins: edges.map((i) => i?.node?.login).filter(Boolean) };
};

const MY_EDITABLE_CHANNELS_HASH = '41f21b92feac17acf29ccb9ee01e07308f229ede3893a4f34439c755496dc821';

/** Channels, in denen der Web-Token-Account Editor ist (Dashboard "My Assigned Roles"). -> { userId, logins, hasNextPage } oder null */
const getEditableChannels = async () => {
	const data = await gqlAuth({ operationName: 'MyEditableChannels', variables: {}, extensions: { persistedQuery: { version: 1, sha256Hash: MY_EDITABLE_CHANNELS_HASH } } });
	const user = data?.currentUser;
	const edges = user?.editableChannels?.edges;
	if (!Array.isArray(edges)) {
		return null;
	}

	return { userId: String(user.id), logins: edges.map((i) => i?.node?.login).filter(Boolean), hasNextPage: Boolean(user.editableChannels.pageInfo?.hasNextPage) };
};

module.exports = {
	getEditableChannels,
	getChannelsWithRole,
	GQL_PUBLIC_CLIENT_ID,
	gqlPublic,
	gqlAuth,
	getUserInfo,
	reportFakeLive,
	getBanStatusBatch,
	gqlSmartbox,
	isUsernameAvailable,
	getRecentVods,
	getVodGameMoments,
	getLastBroadcastStart,
	getUserProfile,
	getChatRestrictedReasons,
	getChannelPointsBalance,
};
