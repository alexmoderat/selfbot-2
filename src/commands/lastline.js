const { commands } = require('../clients/modules/commands.js');

// Supibots commands/lastline. Supibots Alias "ll" bleibt fuer lastlive (Block 6), wie schon in sb-v2 ("llog")
module.exports = {
	name: 'lastline',
	aliases: ['llog', 'lastmessage', 'lm'],
	cooldown: 5000,
	description: "Posts the target user's last chat line in the context of the current channel, and the date they sent it.",
	usage: 'lastline <user> [textOnly:true]',
	flags: ['external-input', 'mention', 'opt-out', 'pipe'],
	params: [{ name: 'textOnly', type: 'boolean' }],
	execute: async (client, msg) => {
		const [user] = msg.args;
		if (!user) {
			return { success: false, text: 'No user provided! You must mention a username to check their last line in this channel.' };
		}

		const channel = msg.channelData;
		const platform = bot.Twitch;
		if (!channel) {
			return { success: false, text: 'This command is not available in PMs!' };
		}

		const targetUser = await bot.Users.get(user);
		if (!targetUser) {
			return { success: false, text: 'User not found in the database!' };
		} else if (targetUser.name === platform.selfName) {
			return { success: false, text: "I'm right here! Boo! 👻" };
		} else if (targetUser.id === msg.sender.id) {
			return { success: false, text: "You're right here! 👻 I can see you" };
		}

		const data = await core.Query.getRecordset((rs) =>
			rs // TODO(port)
				.select('Last_Message_Text AS message', 'Last_Message_Posted AS posted')
				.from('selfbot_data', 'Message_Meta_User_Alias')
				.where('User_Alias = %n', targetUser.id)
				.where('Channel = %n', channel.id)
				.single(),
		);

		if (!data) {
			return { success: false, text: 'That user has not said anything in this channel!' };
		} else if (msg.params.textOnly) {
			return { success: true, text: data.message };
		}

		return { text: `That user's last message in this channel was (${bot.Utils.timeDelta(data.posted)}): ${data.message}` };
	},
	dynamicDescription: (prefix) => [
		'Checks the last message for a provided user, in the context of the current channel.',
		'',
		`<code>${prefix}lastline (user)</code> / <code>${prefix}lm (user)</code>`,
		"Posts that user's last message in this channel.",
	],
};
