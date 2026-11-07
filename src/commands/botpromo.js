/**
 * Periodischer Werbe-Post fuer den Bot (Cron bot-promo) alle 6 h in diesem Channel an/aus, aus sb-v2
 * (ninou2, 29.09.2026: "we need exposure now"). Opt-in pro Channel wie autostatus.
 */
module.exports = {
	name: 'botpromo',
	cooldown: 3000,
	description: "Toggles a periodic 'you can use this bot too' message every 6h (4x per day) in this channel, linking the command list.",
	usage: 'botpromo <on|off>',
	flags: ['mod', 'no-prefix'],
	execute: async (client, msg) => {
		const [subRaw] = msg.args;
		const display = msg.displayName;
		const channel = msg.channelData;
		if (!channel) {
			return { text: `@${display}, this only works in a channel.` };
		}

		const sub = subRaw?.toLowerCase();
		if (sub !== 'on' && sub !== 'off') {
			const current = await bot.Channels.getData(channel, 'botpromo');
			return { text: `@${display}, botpromo in #${channel.name} is ${current ? 'on' : 'off'}. Usage: ${msg.prefix}${msg.invocation} <on|off>` };
		}

		await bot.Channels.setData(channel, 'botpromo', sub === 'on');
		if (sub === 'off') {
			await bot.Channels.setData(channel, 'botpromoNext', null);
		}

		return { text: `@${display}, botpromo for #${channel.name} ${sub === 'on' ? 'enabled' : 'disabled'} — next post within 6h.` };
	},
};
