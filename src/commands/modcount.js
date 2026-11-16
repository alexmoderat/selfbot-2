const { fetchModeratedChannels } = require('../util/twitch/twitch-utils.js');
const { uploadList } = require('../misc/haste.js');
const { fetchUserRoleList } = require('../misc/roles-tv.js');
const { getChannelsWithRole } = require('../misc/twitch-gql.js');

/**
 * In wie vielen Channels ein User Mod ist, aus sb-v2: fuer den Bot selbst ueber Helix moderation/channels, fuer alle
 * anderen ueber roles.tv (ohne Autorisierung - alexmoderat, 29.09.2026: "wir brauchen doch dafuer kein token").
 * sb-v2 las fuer den Bot den moderated_channels_cache des Auto-Join-Crons; den gibt es hier nicht, also live.
 * Link-Inhalt: einfache Namensliste, alphabetisch (alexmoderat, 11.11.2026: das "since" je Channel - ninou2, 06.11.2026 -
 * "interessiert niemanden"; kostete pro Aufruf hunderte GQL-Abfragen).
 */
const sortedLogins = (logins) => [...new Set(logins)].sort((a, b) => a.localeCompare(b));

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

			const logins = sortedLogins(channels.map((i) => i.login));
			const url = await uploadList(`${self} — moderated channels`, logins);
			// Lead-Mod-Kanaele (alexmoderat, 16.11.2026: "mach den leadmod cmd, kannst an ml dranhaengen"); nur wenn der Web-Token zum Bot-Account gehoert
			const lead = await getChannelsWithRole('lead_mod').catch(() => null);
			if (lead && lead.userId === String(twitch.selfId)) {
				const leadUrl = lead.logins.length > 0 ? await uploadList(`${self} — lead mod channels`, sortedLogins(lead.logins)) : null;
				return { text: `@${display}, ${self} mods in ${logins.length} channels: ${url} | Lead Mod in ${lead.logins.length}${leadUrl ? `: ${leadUrl}` : ''}` };
			}

			return { text: `@${display}, ${self} mods in ${logins.length} channels: ${url}` };
		}

		const tv = await fetchUserRoleList(target, 'moderators').catch(() => null);
		if (!tv) {
			// Fallback: StreamDatabase gibt die Liste nur eingeloggten Nutzern per API heraus, also auf die Seite verlinken
			return { text: `https://streamdatabase.com/twitch/moderated-channels/${encodeURIComponent(target)}` };
		}

		// total ist roles.tvs Zahl; die Liste kann ein paar Eintraege kuerzer sein (sb-v2: 204 gegen 202)
		const url = await uploadList(`${target} — moderated channels (via roles.tv)`, sortedLogins(tv.entries.map((i) => i.login)));
		return { text: `@${display}, ${target} mods in ${tv.total} channels (via roles.tv): ${url}` };
	},
};
