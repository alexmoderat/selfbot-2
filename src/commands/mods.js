const { listOrLink } = require('../util/list-reply.js');
const { getChannelRoles } = require('../token/roles-tv.js');

/**
 * Mod- oder VIP-Liste eines Channels, aus sb-v2. Ohne eigene Rollen-Sammlung immer live von roles.tv
 * (alexmoderat, 23.10.2026: "rollen brauchen wir gar nicht speichern") - der live:-Parameter entfaellt damit.
 */
module.exports = {
	name: 'mods',
	aliases: ['vips', 'modlist', 'viplist'],
	cooldown: 3000,
	description: 'Mod or VIP list of a channel (live via roles.tv).',
	usage: 'mods [channel] | vips [channel]',
	flags: ['mod'],
	execute: async (client, msg) => {
		const [target] = msg.args;
		const display = msg.displayName;
		const role = msg.invocation === 'vips' || msg.invocation === 'viplist' ? 'vip' : 'mod';
		const channel = (target ?? msg.channelData?.name ?? '').replace(/^[@#]+/, '').toLowerCase();

		const list = channel ? await getChannelRoles(channel, role) : null;
		if (!list) {
			return { text: `@${display}, channel "${channel}" not found.` };
		}

		const label = role === 'mod' ? 'Mod' : 'VIP';
		if (list.entries.length === 0) {
			return { text: `@${display}, #${channel} has no ${label}s according to Twitch.` };
		}

		const logins = list.entries.map((i) => i.login);
		const source = 'live via roles.tv';
		return {
			text: `@${display}, ${logins.length} ${label}s in #${channel} (${source}): ${await listOrLink(logins, `${label}s in #${channel} (${source})`)}`,
		};
	},
};
