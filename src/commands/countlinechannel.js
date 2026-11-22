// Supibots commands/countlinechannel
const command = {
	name: 'countlinechannel',
	aliases: ['clc'],
	cooldown: { user: 60 },
	access: { channel: 0 },
	description: 'Fetches the number of chat lines in the current channel.',
	usage: 'countlinechannel',
	flags: ['mention', 'pipe', 'skip-banphrase'],
	execute: async ({ client, message: msg }) => {
		const channel = msg.channelData;
		if (!channel) {
			return { success: false, text: 'This command is not available in private messages!' };
		}

		const [sum] = await bot.DB.MessageMetaUserAlias.aggregate([{ $match: { channel: channel.id } }, { $group: { _id: null, total: { $sum: '$messageCount' } } }]);
		const amount = sum?.total;

		// Gilt fuer undefined (keine Meta-Zeilen) und 0
		if (!amount) {
			return { success: false, text: `I have not processed any messages in this channel so far, but this should change very shortly.` };
		}

		return `I have processed ${bot.Utils.groupDigits(Number(amount))} messages in this channel so far.`;
	},
};

module.exports = { command };
