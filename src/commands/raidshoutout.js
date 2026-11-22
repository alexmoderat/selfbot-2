/** Automatischen Raid-Shoutout (Modul raid-shoutout) je Channel an/aus, aus sb-v2 */
const command = {
	name: 'raidshoutout',
	cooldown: { user: 3 },
	access: { channel: 2 },
	description: 'Turns the automatic raid shoutout on or off for this channel.',
	usage: 'raidshoutout <on|off>',
	flags: ['no-prefix'],
	execute: async ({ client, message: msg }) => {
		const [state] = msg.args;
		const display = msg.displayName;
		const channel = msg.channelData;
		if (!channel) {
			return `@${display}, this only works in a channel.`;
		}

		const value = state?.toLowerCase();
		if (value !== 'on' && value !== 'off') {
			// sb-v2 antwortete hier "an"/"aus" - Chat-Antworten sind englisch
			const current = (await bot.Channels.getData(channel, 'raidShoutout')) === true;
			return `@${display}, Raid shoutout in #${channel.name}: ${current ? 'on' : 'off'}. Usage: raidshoutout <on|off>`;
		}

		await bot.Channels.setData(channel, 'raidShoutout', value === 'on');
		return `@${display}, Raid shoutout in #${channel.name} ${value === 'on' ? 'enabled' : 'disabled'}.`;
	},
};

module.exports = { command };
