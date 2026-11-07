const { fetchTwitchUser } = require('../../../util/twitch/twitch-utils.js');
const { banUser, resolveTarget, restrictUser, unbanUser } = require('../../../services/moderation.js');

// Moderations-Kuerzel fuer den eval (alexmoderat, 05.11.2026: "dieser bot hat ueberall kuerzer" - dort
// sb.svc.twitch.gql.manageChatRestriction({ channelID, targetID, treatment })). Hier mit Logins statt IDs:
// "=js return mod.restrict('kattah', 'forsen')". Bans/Timeouts laufen ueber banUser() (Ban-Log, autoban-Schalter).

const TREATMENTS = {
	restricted: 'restricted',
	restrict: 'restricted',
	r: 'restricted',
	activemonitoring: 'active_monitoring',
	monitor: 'active_monitoring',
	monitored: 'active_monitoring',
	m: 'active_monitoring',
	none: 'no_treatment',
	notreatment: 'no_treatment',
	off: 'no_treatment',
	unrestrict: 'no_treatment',
};

/** "restricted", "monitor", "none", "ACTIVE_MONITORING" ... -> Helix-Wert, sonst null */
const parseTreatment = (input) => TREATMENTS[input.toLowerCase().replace(/[\s_-]/g, '')] ?? null;

const normalizeLogin = (login) =>
	login
		.trim()
		.replace(/^[@#]+/, '')
		.toLowerCase();

const target = async (channel, user) => {
	const found = await fetchTwitchUser(normalizeLogin(user));
	if (!found) {
		throw new Error(`unknown user "${user}"`);
	}

	const result = await resolveTarget(normalizeLogin(channel), found.id, found.login);
	if (!result) {
		throw new Error(`unknown channel "${channel}"`);
	}

	return result;
};

const failure = (response) => {
	const message = response.body?.message;
	return `failed [${response.statusCode}]${message ? `: ${message}` : ''}`;
};

const modShortcuts = {
	/** treatment: restricted (Standard), monitor, none */
	restrict: async (channel, user, treatment = 'restricted') => {
		const value = parseTreatment(treatment);
		if (!value) {
			throw new Error(`unknown treatment "${treatment}" (restricted, monitor, none)`);
		}

		const t = await target(channel, user);
		const response = await restrictUser(t, value);
		return response.ok ? `${t.userName} → ${value} in #${t.channelName}` : failure(response);
	},
	ban: async (channel, user, reason = '') => {
		const t = await target(channel, user);
		const ok = await banUser(t, { reason, status: 'MANUAL' });
		return ok ? `${t.userName} banned in #${t.channelName}` : 'failed (see pm2 logs)';
	},
	timeout: async (channel, user, seconds = 600, reason = '') => {
		const t = await target(channel, user);
		const ok = await banUser(t, { reason, duration: seconds, status: 'MANUAL' });
		return ok ? `${t.userName} timed out for ${seconds}s in #${t.channelName}` : 'failed (see pm2 logs)';
	},
	unban: async (channel, user) => {
		const t = await target(channel, user);
		const response = await unbanUser(t);
		return response.ok ? `${t.userName} unbanned in #${t.channelName}` : failure(response);
	},
};

/** Twitch-ID zu einem Login, null wenn es ihn nicht gibt */
const idOf = async (login) => (await fetchTwitchUser(normalizeLogin(login)))?.id ?? null;

module.exports = { parseTreatment, modShortcuts, idOf };
