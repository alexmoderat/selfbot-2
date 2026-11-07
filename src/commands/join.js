const { isProtected, joinByLogin, partChannel } = require('../services/channel-manager.js');

/**
 * Channel betreten oder verlassen, aus sb-v2. part merkt sich den Grund "manual", damit auto-join den Channel nicht
 * gleich wieder betritt (Vorfall #wiihxhx, 01.08.2026). Ein Tippfehler bei part meldet "not in", statt still als
 * Erfolg durchzugehen (Vorfall #okayfionaa, 15.08.2026).
 */
module.exports = {
	name: 'join',
	aliases: ['part'],
	cooldown: 3000,
	description: 'Join or leave a channel.',
	usage: 'join <channel> | part [channel]',
	flags: ['mod'],
	execute: async (client, msg) => {
		const [targetRaw] = msg.args;
		const display = msg.displayName;
		const isPart = msg.invocation === 'part';
		const target = (targetRaw ?? (isPart ? msg.channelData?.name : null))?.replace(/^#+/, '').toLowerCase();
		if (!target) {
			return { text: `@${display}, Usage: ${msg.prefix}${msg.invocation} <channel>` };
		}

		if (isPart) {
			const channel = bot.Channels.get(target);
			if (!channel || channel.mode === 'Inactive') {
				return { text: `@${display}, not in #${target}.` };
			} else if (isProtected(channel)) {
				return { text: `@${display}, #${target} is protected and can't be left.` };
			}

			await partChannel(channel);
			return { text: `@${display}, parted #${target}` };
		}

		try {
			const result = await joinByLogin(target);
			if (result.status === 'notfound') {
				return { text: `@${display}, join failed for #${target}: channel not found.` };
			} else if (result.status === 'already') {
				return { text: `@${display}, already in #${result.channel.name}` };
			}

			return { text: `@${display}, joined #${result.channel.name}` };
		} catch (e) {
			return { text: `@${display}, join failed for #${target}: ${e.message}` };
		}
	},
};
