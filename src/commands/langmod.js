/** An/Aus der Uebersetzungs-Moderation (Modul language-moderation) pro Channel, Default aus - aus sb-v2 */
const command = {
	name: 'langmod',
	cooldown: { user: 3 },
	access: { channel: 2 },
	description: 'Turns automatic translation-based moderation on or off for this channel.',
	usage: 'langmod <on|off>',
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
			const current = await bot.Channels.getData(channel, 'languageModeration');
			// sb-v2 antwortete hier noch mit "an/aus" - Antworten sind Englisch
			return `@${display}, language moderation in #${channel.name}: ${current ? 'on' : 'off'}. Usage: ${msg.prefix}${msg.invocation} <on|off>`;
		}

		await bot.Channels.setData(channel, 'languageModeration', value === 'on');
		return `@${display}, language moderation in #${channel.name} ${value === 'on' ? 'enabled' : 'disabled'}.`;
	},
};

module.exports = { command };
