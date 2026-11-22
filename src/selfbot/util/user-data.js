const { ago, formatDuration } = require('../misc/humanizeDuration.js');
const gql = require('../token/gql.js');

/**
 * Account-Infos zu einem Twitch-User (aus dem Command user, sb-v2: user/u ausfuehrlich, whois/lookup kompakt), als Daten
 * fuer die Variablen {u_*} der Custom Commands (alexmoderat, 22.11.2026: "den user cmd kannst auch als custom machen").
 * u_kind: usage | notfound | banned | ok. Bitrate und FPS liefert keine der Quellen, dafuer gibt es "si".
 */
const ROLE_LABELS = [
	['isPartner', 'Partner'],
	['isAffiliate', 'Affiliate'],
	['isStaff', 'Staff'],
	['isSiteAdmin', 'Site Admin'],
	['isGlobalMod', 'Global Mod'],
	['isExtensionsDeveloper', 'Ext Dev'],
];

const rolesOf = (u, fallback) => {
	const found = ROLE_LABELS.filter(([key]) => u.roles?.[key]).map(([, label]) => label);
	return found.length > 0 ? found.join(', ') : fallback;
};

const BAN_TYPES = { TOS_INDEFINITE: 'indefinite', TOS_TEMPORARY: 'temporary', DMCA: 'dmca' };

const oneLine = (text) => (text ?? '').trim().replace(/\s+/g, ' ');

// alexmoderat, 30.10.2026: bei "not found" dazu, ob der Name frei ist (ueber Twitchs eigene Pruefung - ein nicht
// gefundener Name kann trotzdem reserviert oder zu kurz sein)
const availableText = (available) => (available === true ? ' · name is available!' : available === false ? ' · name is not available (reserved or not allowed)' : '');

const getUserData = async (login) => {
	if (!login) {
		return { kind: 'usage', login };
	}

	const u = await gql.getUserProfile(login);
	// GQL antwortet auch fuer nie existierende Logins mit "gesperrt", dann ohne Grund und ohne ID
	if (!u || (u.banned && u.banReason === 'UNKNOWN' && !u.id)) {
		return { kind: 'notfound', login, available: availableText(await gql.isUsernameAvailable(login)) };
	}

	const base = {
		login: u.login,
		name: u.displayName || u.login,
		display: u.displayName,
		id: String(u.id ?? ''),
		created: ago(u.createdAt ?? ''),
		lastLiveAgo: ago(u.lastBroadcast?.startedAt ?? ''),
	};
	if (u.banned) {
		return { ...base, kind: 'banned', banType: BAN_TYPES[u.banReason ?? ''] ?? String(u.banReason ?? 'unknown').toLowerCase() };
	}

	const bio = oneLine(u.bio);
	// Laeuft ein Stream, ersetzt er die "last live"-Angabe
	let tail = '';
	if (u.stream?.type === 'live') {
		tail = ` · 🔴 playing: ${u.stream.game_name || 'Unknown'} · viewers: ${u.stream.viewer_count.toLocaleString('en-US')} · uptime: ${formatDuration(Date.now() - new Date(u.stream.started_at).getTime())}`;
	} else if (u.lastBroadcast?.startedAt) {
		tail = ` · last live: ${ago(u.lastBroadcast.startedAt)} ago`;
	}

	const reasons = await gql.getChatRestrictedReasons(login);
	return {
		...base,
		kind: 'ok',
		color: u.chatColor || 'n/a',
		roles: rolesOf(u, 'User'),
		rolesCompact: rolesOf(u, 'none').toLowerCase(),
		followers: u.followers !== null && u.followers !== undefined ? ` · followers: ${u.followers.toLocaleString('en-US')}` : '',
		bio: bio ? (bio.length > 60 ? `${bio.slice(0, 57)}...` : bio) : 'n/a',
		bioCompact: bio || 'none',
		tail,
		tailCompact: u.lastBroadcast?.startedAt ? ` · last live: ${ago(u.lastBroadcast.startedAt)} ago` : '',
		restricted: reasons?.includes('CHANNEL_HAS_CONSEQUENCE') ? '1' : '',
	};
};

module.exports = { getUserData };
