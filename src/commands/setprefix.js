const { prefixProblem } = require('../clients/modules/invocation.js');
const { getPermissions } = require('../clients/modules/handler.js');

/**
 * Eigenen Prefix pro Channel setzen oder zuruecksetzen (sb-v2). Darf der Channel-Besitzer fuer den eigenen Channel
 * (ninou2, 03.11.2026), hoechstens 3 Zeichen; channel:name bleibt den Bot-Administratoren vorbehalten.
 */
module.exports = {
	name: 'setprefix',
	cooldown: 3000,
	description: "Set or reset your channel's own command prefix, any word or symbol up to 3 characters. Only the channel owner can do this.",
	usage: 'setprefix <prefix|reset> [channel:name]',
	// Zuruecksetzen nur nach zweiter Bestaetigung (ninou2, 06.10.2026)
	flags: ['mod', 'confirm'],
	params: [{ name: 'channel', type: 'string' }],
	execute: async (client, msg) => {
		const display = msg.displayName;
		const permissions = getPermissions(msg);
		if (!permissions.administrator && (!permissions.channelOwner || msg.params.channel)) {
			return { text: `@${display}, only the owner of this channel can change its prefix.` };
		}

		const fallback = bot.Config.prefix;
		const newPrefix = msg.args.join(' ').trim().toLowerCase();
		if (!newPrefix) {
			return {
				text: `@${display}, Usage: ${msg.prefix}${msg.invocation} <prefix|reset> [channel:name] — e.g. "!" makes "!remind" work. "${msg.prefix}${msg.invocation} reset" restores the default.`,
			};
		}

		const channelName = (msg.params.channel ?? msg.channelData?.name ?? '').replace(/^#+/, '').toLowerCase();
		const channel = bot.Channels.get(channelName);
		if (!channel) {
			return { text: `@${display}, I'm not in #${channelName || '?'}.` };
		}

		if (newPrefix === 'reset') {
			await bot.Channels.setData(channel, 'prefix', null);
			return { text: `@${display}, prefix in #${channel.name} reset to default (${fallback}).` };
		}
		else if (newPrefix === fallback.toLowerCase()) {
			return { text: `@${display}, "${newPrefix}" is already the default prefix — no custom one needed.` };
		}

		const problem = prefixProblem(newPrefix);
		if (problem) {
			return { text: `@${display}, that prefix doesn't work: ${problem}.` };
		}

		await bot.Channels.setData(channel, 'prefix', newPrefix);
		const example = /^[\p{L}\p{N}]+$/u.test(newPrefix) ? `${newPrefix} ping` : `${newPrefix}ping`;
		return { text: `@${display}, prefix in #${channel.name} set to "${newPrefix}", for example: ${example}. "${fallback} ping" keeps working too.` };
	},
};
