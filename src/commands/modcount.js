const { fetchModeratedChannels } = require('../util/twitch/twitch-utils.js');
const { uploadToHaste } = require('../misc/haste.js');
const { fetchUserRoleList } = require('../misc/roles-tv.js');
const { getModSinceMany, sortBySince } = require('../misc/mod-since.js');

/**
 * In wie vielen Channels ein User Mod ist, aus sb-v2: fuer den Bot selbst ueber Helix moderation/channels, fuer alle
 * anderen ueber roles.tv (ohne Autorisierung - alexmoderat, 29.09.2026: "wir brauchen doch dafuer kein token").
 * sb-v2 las fuer den Bot den moderated_channels_cache des Auto-Join-Crons; den gibt es hier nicht, also live.
 * Jeder Channel bekommt "since" (Datum der Mod-Vergabe, ninou2, 06.11.2026), aelteste zuerst; bei sehr vielen
 * Channels nur die ersten DATED_MAX, damit ein Aufruf nicht tausende GQL-Abfragen ausloest.
 */
const DATED_MAX = 300;

const withSince = async (rows, mod) => {
	if (rows.length > DATED_MAX) {
		return { rows: rows.map((i) => ({ ...i, since: null })), dated: false };
	}

	const since = await getModSinceMany(
		rows.map((i) => i.login),
		mod,
	);
	const dated = rows.map((i) => ({ ...i, since: since.get(i.login)?.slice(0, 10) ?? null }));
	return { rows: sortBySince(dated), dated: true };
};

module.exports = {
	name: 'modcount',
	aliases: ['ml'],
	cooldown: 3000,
	description: 'In how many channels a user is a moderator.',
	usage: 'modcount [user]',
	execute: async (client, msg) => {
		const [targetRaw] = msg.args;
		const display = msg.displayName;
		const target = (targetRaw ?? msg.sender.name).toLowerCase().replace('@', '');
		const twitch = bot.Twitch;
		const self = twitch.selfName;

		if (target === self) {
			const channels = await fetchModeratedChannels(twitch.selfId);
			if (!channels) {
				return { text: `@${display}, couldn't get the moderated channels from Twitch right now.` };
			}

			const { rows: json } = await withSince(
				channels.map((i) => ({ broadcasterId: i.id, login: i.login, name: i.login })),
				self,
			);
			const url = await uploadToHaste(JSON.stringify({ user: self, count: json.length, channels: json }, null, 2));
			return { text: `@${display}, ${self} mods in ${json.length} channels: ${url}` };
		}

		const tv = await fetchUserRoleList(target, 'moderators').catch(() => null);
		if (!tv) {
			return { text: `@${display}, couldn't get mod data for ${target} (roles.tv unavailable or unknown user).` };
		}

		// total ist roles.tvs Zahl; die Liste kann ein paar Eintraege kuerzer sein (sb-v2: 204 gegen 202)
		const { rows: json, dated } = await withSince(
			tv.entries.map((i) => ({ login: i.login, name: i.displayName ?? i.login })),
			target,
		);
		const url = await uploadToHaste(
			JSON.stringify(
				{
					user: target,
					source: 'roles.tv',
					count: tv.total,
					listed: json.length,
					...(dated ? {} : { note: `no dates above ${DATED_MAX} channels` }),
					channels: json,
				},
				null,
				2,
			),
		);
		return { text: `@${display}, ${target} mods in ${tv.total} channels (via roles.tv): ${url}` };
	},
};
