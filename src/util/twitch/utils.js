// Kleine Twitch-Helfer ohne Netzwerk

/** Badge-Sets, die als Mod zaehlen ("lead_moderator" = vom Broadcaster befoerderte Mods) */
const MODERATOR_BADGES = new Set(['moderator', 'lead_moderator']);

/** dank-twitch-irc BadgesList -> [{ set_id, id, info }] wie bisher (EventSub-Form) */
const toBadgeList = (badges, badgeInfo) => {
	const infos = new Map([...(badgeInfo ?? [])].map((i) => [i.name, i.version]));
	return [...(badges ?? [])].map((i) => ({ set_id: i.name, id: i.version ?? '', info: infos.get(i.name) ?? '' }));
};

/** Bei Antworten stellt Twitch "@name " vor den Text - fuer die Command-Erkennung wird das entfernt */
const stripReplyMention = (text, isReply) => (isReply ? text.replace(/^@\S+\s+/, '') : text);

/** Login aus Eingaben wie "@Name," oder "#name" */
const ParseUser = (input) =>
	String(input ?? '')
		.toLowerCase()
		.replace(/^[@#]/, '')
		.replace(/,$/, '')
		.trim();

/** Auf das Nachrichtenlimit kuerzen, Zeilenumbrueche zu Leerzeichen */
const trimMessage = (message, limit) => {
	const clean = String(message).replace(/\s+/g, ' ').trim();
	return clean.length > limit ? `${clean.slice(0, limit - 1)}…` : clean;
};

module.exports = { MODERATOR_BADGES, toBadgeList, stripReplyMention, ParseUser, trimMessage };
