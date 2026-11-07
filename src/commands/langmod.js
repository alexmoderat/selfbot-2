/** An/Aus der Uebersetzungs-Moderation (Modul language-moderation) pro Channel, Default aus - aus sb-v2 */
module.exports = {
	name: 'langmod',
	cooldown: 3000,
	description: 'Turns automatic translation-based moderation on or off for this channel.',
	usage: 'langmod <on|off>',
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
			const current = await bot.Channels.getData(channel, 'languageModeration');
			// sb-v2 antwortete hier noch mit "an/aus" - Antworten sind Englisch
			return { text: `@${display}, language moderation in #${channel.name}: ${current ? 'on' : 'off'}. Usage: ${msg.prefix}${msg.invocation} <on|off>` };
		}

		await bot.Channels.setData(channel, 'languageModeration', value === 'on');
		return { text: `@${display}, language moderation in #${channel.name} ${value === 'on' ? 'enabled' : 'disabled'}.` };
	},
};
