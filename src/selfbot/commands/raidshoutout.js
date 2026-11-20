/** Automatischen Raid-Shoutout (Modul raid-shoutout) je Channel an/aus, aus sb-v2 */
module.exports = {
	name: 'raidshoutout',
	cooldown: 3000,
	description: 'Turns the automatic raid shoutout on or off for this channel.',
	usage: 'raidshoutout <on|off>',
	flags: ['mod', 'no-prefix'],
	execute: async (client, msg) => {
		const [state] = msg.args;
		const display = msg.displayName;
		const channel = msg.channelData;
		if (!channel) {
			return { text: `@${display}, this only works in a channel.` };
		}

		const value = state?.toLowerCase();
		if (value !== 'on' && value !== 'off') {
			// sb-v2 antwortete hier "an"/"aus" - Chat-Antworten sind englisch
			const current = (await bot.Channels.getData(channel, 'raidShoutout')) === true;
			return { text: `@${display}, Raid shoutout in #${channel.name}: ${current ? 'on' : 'off'}. Usage: raidshoutout <on|off>` };
		}

		await bot.Channels.setData(channel, 'raidShoutout', value === 'on');
		return { text: `@${display}, Raid shoutout in #${channel.name} ${value === 'on' ? 'enabled' : 'disabled'}.` };
	},
};
