const { ago, formatDuration } = require('../misc/duration.js');
const { getChatRestrictedReasons, getUserProfile, isUsernameAvailable } = require('../misc/twitch-gql.js');

/**
 * Account-Infos zu einem User, aus sb-v2: user/u ausfuehrlich, whois/lookup kompakt.
 * Bitrate und FPS liefert keine der Quellen, dafuer gibt es "si".
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

const bannedLine = (u) => {
	const type = BAN_TYPES[u.banReason ?? ''] ?? String(u.banReason ?? 'unknown').toLowerCase();
	return (
		`@${u.displayName || u.login}, banType: ${type} · id: ${u.id} · login: ${u.login}` +
		` · last live: ${ago(u.lastBroadcast?.startedAt ?? '')} ago · created: ${ago(u.createdAt ?? '')} ago`
	);
};

const detailed = (u) => {
	const bio = (u.bio ?? '').trim().replace(/\s+/g, ' ');
	const bioText = bio ? (bio.length > 60 ? `${bio.slice(0, 57)}...` : bio) : 'n/a';

	// Laeuft ein Stream, ersetzt er die "last live"-Angabe
	let tail = '';
	if (u.stream?.type === 'live') {
		const viewers = u.stream.viewer_count.toLocaleString('en-US');
		const uptime = formatDuration(Date.now() - new Date(u.stream.started_at).getTime());
		tail = ` · 🔴 playing: ${u.stream.game_name || 'Unknown'} · viewers: ${viewers} · uptime: ${uptime}`;
	} else if (u.lastBroadcast?.startedAt) {
		tail = ` · last live: ${ago(u.lastBroadcast.startedAt)} ago`;
	}

	const followers = u.followers !== null ? ` · followers: ${u.followers.toLocaleString('en-US')}` : '';
	return (
		`${u.displayName}: @${u.login}, id: ${u.id} · color: ${u.chatColor || 'n/a'}` +
		` · roles: ${rolesOf(u, 'User')}${followers} · bio: ${bioText}` +
		` · created: ${ago(u.createdAt ?? '')} ago${tail}`
	);
};

const compact = (u, caller) => {
	const bio = (u.bio ?? '').trim().replace(/\s+/g, ' ') || 'none';
	const lastLive = u.lastBroadcast?.startedAt ? ` · last live: ${ago(u.lastBroadcast.startedAt)} ago` : '';
	return (
		`@${caller}, id: ${u.id} · login: ${u.login} · roles: ${rolesOf(u, 'none').toLowerCase()}` +
		` · bio: ${bio}${lastLive} · created: ${ago(u.createdAt ?? '')} ago`
	);
};

// alexmoderat, 30.10.2026: bei "not found" dazu, ob der Name frei ist (wie PotatBotat, aber ueber Twitchs eigene
// Pruefung - ein nicht gefundener Name kann trotzdem reserviert oder zu kurz sein)
const notFoundReply = (display, login, available) => {
	const suffix = available === true ? ' · name is available!' : available === false ? ' · name is not available (reserved or not allowed)' : '';
	return `@${display}, user "${login}" not found${suffix}`;
};

module.exports = {
	name: 'user',
	aliases: ['u', 'whois', 'lookup'],
	cooldown: 3000,
	description: 'Account info for a user (whois/lookup = compact version).',
	usage: 'user <name> | whois <name>',
	flags: ['mod'],
	execute: async (client, msg) => {
		const [target] = msg.args;
		const display = msg.displayName;
		const login = (target ?? '')
			.toLowerCase()
			.replace(/^[@#]+/, '')
			.trim();
		if (!login) {
			return { text: `@${display}, Usage: ${msg.invocation} <user>` };
		}

		const u = await getUserProfile(login);
		if (!u) {
			return { text: notFoundReply(display, login, await isUsernameAvailable(login)) };
		}

		// GQL antwortet auch fuer nie existierende Logins mit "gesperrt", dann ohne Grund und ohne ID
		if (u.banned && u.banReason === 'UNKNOWN' && !u.id) {
			return { text: notFoundReply(display, login, await isUsernameAvailable(login)) };
		}
		if (u.banned) {
			return { text: bannedLine(u) };
		}

		const isCompact = msg.invocation === 'whois' || msg.invocation === 'lookup';
		const base = isCompact ? compact(u, display) : detailed(u);

		const reasons = await getChatRestrictedReasons(login);
		return {
			text: reasons?.includes('CHANNEL_HAS_CONSEQUENCE')
				? `⚠️ @${u.displayName || u.login} · Chat is currently disabled in their channel · ${base}`
				: base,
		};
	},
};

Object.assign(module.exports, { rolesOf, bannedLine, detailed, compact, notFoundReply });
