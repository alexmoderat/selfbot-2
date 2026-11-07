const { commands } = require('../clients/modules/commands.js');

// Supibots commands/countline. sb-v2s "messages"/"msgs" zaehlten dasselbe und bleiben als Aliase erhalten
module.exports = {
	name: 'countline',
	aliases: ['cl', 'messages', 'msgs'],
	cooldown: 10000,
	description: 'Fetches the number of chat lines a specified user (or you, if nothing is provided) has sent in the current channel.',
	usage: 'countline [user]',
	flags: ['mention', 'opt-out', 'pipe'],
	execute: async (client, msg) => {
		const [username] = msg.args;
		const channelData = msg.channelData;
		if (!channelData) {
			return { success: false, text: `This command is not available in private messages!` };
		}

		const userData = username ? await bot.Users.get(username) : msg.sender;
		if (!userData) {
			return { success: false, text: 'No such user exists in the database!' };
		}

		const lines = await core.Query.getRecordset((rs) =>
			rs // TODO(port)
				.select('Message_Count AS Total')
				.from('selfbot_data', 'Message_Meta_User_Alias')
				.where('User_Alias = %n', userData.id)
				.where('Channel = %n', channelData.id)
				.single()
				.flat('Total'),
		);

		const who = userData.id === msg.sender.id ? 'You have' : 'That user has';
		if (!lines) {
			return { success: true, text: `${who} sent no chat lines in this channel!` };
		}

		return { success: true, text: `${who} sent ${bot.Utils.groupDigits(lines)} chat lines in this channel so far.` };
	},
};
