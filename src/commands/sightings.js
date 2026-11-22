const utility = require('../database/utility.js');
const { got } = require('../token/got.js');
const { fetchTwitchUser } = require('../util/twitch/twitch-utils.js');
const { uploadToHaste } = require('../token/haste.js');
const { formatReport, summarize } = require('../util/sightings.js');

/**
 * Sichtungen aus chat_data.first_message_sightings (Network-Bot-Radar, gemeinsam mit sb-v2 und autojoin-bot): in wie vielen Channels ein Account zuerst geschrieben
 * hat, aus sb-v2. Dort lief die Abfrage ~40 s (23 Mio. Zeilen ohne Index auf user_id) - hier liegt ein Index auf
 * User_ID, deshalb ohne Lauf-Sperre und Zwischenmeldung.
 * alexmoderat, 11.10.2026: der Reply zitiert keinen Nachrichtentext mehr (der Bot haette sonst Viewbot-Domains
 * selbst im Chat wiederholt) - die vollen Texte stehen nur im Haste-Report.
 */
const MAX_ROWS = 2000;

/**
 * Name oder User-ID -> { id, login }. Gesperrte Accounts liefert Helix nicht mehr - die Sichtungen liegen aber nach
 * User-ID vor; IVR kennt auch gesperrte (alexmoderat, 27.10.2026: "sightings matukovich" -> not found, obwohl !user
 * die ID zeigte). Eine reine Zahl gilt als User-ID.
 */
const resolveUser = async (input) => {
	const byId = /^\d+$/.test(input);
	const helix = await fetchTwitchUser(input, { byId }).catch(() => null);
	if (helix) {
		return { id: helix.id, login: helix.login };
	}

	const response = await got('IVR')({
		url: 'v2/twitch/user',
		searchParams: byId ? { id: input } : { login: input },
		throwHttpErrors: false,
	});
	const ivr = response.ok && Array.isArray(response.body) ? response.body[0] : undefined;
	if (ivr) {
		return { id: String(ivr.id), login: ivr.login };
	}

	// Unbekannte ID: trotzdem im Radar-Log nachsehen
	return byId ? { id: input, login: input } : null;
};

const ago = (date) => {
	const minutes = Math.max(0, Math.round((Date.now() - date.getTime()) / 60_000));
	if (minutes < 60) {
		return `${minutes}m ago`;
	}

	const hours = Math.round(minutes / 60);
	return hours < 48 ? `${hours}h ago` : `${Math.round(hours / 24)}d ago`;
};
const day = (date) => date.toISOString().slice(0, 10);

const command = {
	name: 'sightings',
	cooldown: { user: 3 },
	access: { channel: 2 },
	description: 'Where and what an account wrote as first message across the radar channels.',
	usage: 'sightings <user or user ID>',
	execute: async ({ client, message: msg }) => {
		const [userRaw] = msg.args;
		const display = msg.displayName;
		const login = userRaw?.replace(/^@/, '').toLowerCase();
		if (!login) {
			return `@${display}, Usage: ${msg.prefix}${msg.invocation} <user>`;
		}

		const user = await resolveUser(login);
		if (!user) {
			return `@${display}, user "${login}" not found.`;
		}

		// gehoert utility-next (geteilte Daten in Postgres utility_next)
		const rows = await utility.query(
			'SELECT channel AS "Channel_Name", seen_at AS "Seen_At", normalized_text AS "Normalized_Text" FROM first_message_sightings WHERE user_id = ? ORDER BY seen_at ASC LIMIT ?',
			[user.id, MAX_ROWS + 1],
		);

		const truncated = rows.length > MAX_ROWS;
		const list = truncated ? rows.slice(0, MAX_ROWS) : rows;
		const summary = summarize(list);
		if (!summary) {
			return `@${display}, no sightings of ${user.login} (${user.id}) in the radar log.`;
		}

		const url = await uploadToHaste(formatReport(user.login, user.id, list, truncated)).catch(() => null);
		return `@${display}, ${user.login} (${user.id}): ${summary.count}${truncated ? '+' : ''} sightings in ${summary.channels} channels, ` +
				`${day(summary.firstSeen)} → ${day(summary.lastSeen)} (last: #${summary.lastChannel}, ${ago(summary.lastSeen)})` +
				`${url ? ` · full report: ${url}` : ''}`;
	},
};

module.exports = { command };
