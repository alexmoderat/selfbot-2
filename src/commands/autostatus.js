const { formatDuration, parseDurationText } = require('../misc/humanizeDuration.js');

/**
 * Periodischer Status-Post (Cron autostatus) alle 8 h fuer diesen Channel an/aus, aus sb-v2. "delay <dauer>" verschiebt
 * nur den naechsten Post einmalig (z. B. "3h", "14h24m"), danach gilt wieder der 8-h-Rhythmus.
 */
module.exports = {
	name: 'autostatus',
	cooldown: 3000,
	description: 'Toggles the automatic status message every 8h in this channel; delay postpones just the next one.',
	usage: 'autostatus <on|off> | autostatus delay <duration> (e.g. 3h, 14h24m)',
	flags: ['mod'],
	execute: async (client, msg) => {
		const args = [...msg.args];
		const display = msg.displayName;
		const channel = msg.channelData;
		if (!channel) {
			return { text: `@${display}, this only works in a channel.` };
		}

		const sub = args[0]?.toLowerCase();
		if (sub === 'delay') {
			const ms = parseDurationText(args.slice(1).join(''));
			if (!ms) {
				return { text: `@${display}, Usage: ${msg.prefix}${msg.invocation} delay <duration> (e.g. 3h, 14h24m)` };
			}

			await bot.Channels.setData(channel, 'autostatusNext', Date.now() + ms);
			return {
				text: `@${display}, next autostatus post in #${channel.name} delayed by ${formatDuration(ms)} — falls back to the normal 8h cadence after that.`,
			};
		} else if (sub !== 'on' && sub !== 'off') {
			const current = await bot.Channels.getData(channel, 'autostatus');
			return {
				text: `@${display}, autostatus in #${channel.name} is ${current ? 'on' : 'off'}. Usage: ${msg.prefix}${msg.invocation} <on|off|delay <duration>>`,
			};
		}

		await bot.Channels.setData(channel, 'autostatus', sub === 'on');
		if (sub === 'off') {
			await bot.Channels.setData(channel, 'autostatusNext', null);
		}

		return { text: `@${display}, autostatus for #${channel.name} ${sub === 'on' ? 'enabled' : 'disabled'} — next post within 8h.` };
	},
};
