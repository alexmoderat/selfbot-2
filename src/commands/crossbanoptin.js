const { getPermissions } = require('../clients/modules/handler.js');

/**
 * Opt-in je Channel fuer !crossban, standardmaessig AUS (aus sb-v2). Mod-Recht, damit jedes Mod-Team selbst
 * entscheidet. Ein fremder Ziel-Channel per Argument nur fuer den Bot-Owner (alexmoderat, 22.09.2026).
 */
module.exports = {
	name: 'crossbanoptin',
	aliases: ['cbopt'],
	cooldown: 3000,
	description:
		'Opts a channel in/out of !crossban (network-wide bans get applied there too). Owner: target another channel with "channel:name" or a second word.',
	usage: 'crossbanoptin <on|off> [channel:name]',
	flags: ['mod'],
	params: [{ name: 'channel', type: 'string' }],
	execute: async (client, msg) => {
		const [sub, bare] = msg.args;
		const display = msg.displayName;
		const raw = msg.params.channel ?? bare;
		const targetName = raw ? raw.replace(/^#+/, '').toLowerCase() : msg.channelData?.name;
		if (!targetName) {
			return { text: `@${display}, this only works in a channel.` };
		}

		if (targetName !== msg.channelData?.name) {
			const permissions = getPermissions(msg);
			if (!permissions.administrator) {
				return { text: `@${display}, targeting another channel is bot owner only — type it in #${targetName} itself instead.` };
			}
		}

		const channel = bot.Channels.get(targetName);
		if (!channel) {
			return { text: `@${display}, I'm not in #${targetName}.` };
		}

		const value = sub?.toLowerCase();
		if (value !== 'on' && value !== 'off') {
			const current = await bot.Channels.getData(channel, 'crossbanOptIn');
			return {
				text: `@${display}, crossban opt-in for #${channel.name} is ${current ? 'on' : 'off'}. Usage: ${msg.prefix}${msg.invocation} <on|off> [channel:name]`,
			};
		}

		await bot.Channels.setData(channel, 'crossbanOptIn', value === 'on');
		return { text: `@${display}, #${channel.name} is now ${value === 'on' ? 'opted in to' : 'opted out of'} !crossban.` };
	},
};
