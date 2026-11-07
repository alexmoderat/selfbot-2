// Supibots commands/firstline (alexmoderat, 23.10.2026: Supibot-Modell fuer Chat-Logs)
module.exports = {
	name: 'firstline',
	aliases: ['fl'],
	cooldown: 5000,
	description: "Posts the target user's first chat line in the context of the current or a specified channel, and the date they sent it.",
	usage: 'firstline [user] [channel:name] [textOnly:true]',
	flags: ['external-input', 'mention', 'opt-out', 'pipe'],
	params: [
		{ name: 'channel', type: 'string' },
		{ name: 'textOnly', type: 'boolean' },
	],
	execute: async (client, msg) => {
		const [user] = msg.args;
		const { channel } = msg.params;
		if (!msg.channelData && !channel) {
			return {
				success: false,
				text: "In order to use this command in private messages, you have to provide a channel parameter! Check the command's extended help for more info.",
			};
		}

		const targetChannel = channel ? bot.Channels.get(channel.replace(/^#/, ''), bot.Twitch) : msg.channelData;
		if (!targetChannel) {
			return { success: false, text: "Couldn't find that channel in my database!" };
		} else if (targetChannel.mode === 'Inactive') {
			return { success: false, text: `I'm not currently active in that channel!` };
		}

		const channelArticle = targetChannel === msg.channelData ? 'this' : 'that';
		const targetUser = user ? await bot.Users.get(user) : msg.sender;
		if (!targetUser) {
			return { success: false, text: "Couldn't find that user in my database!" };
		}

		const meta = await bot.DB.MessageMetaUserAlias.findOne({ userAlias: targetUser.id, channel: targetChannel.id }).lean();
		const metadata = meta ? { First_Message_Posted: meta.firstMessagePosted, First_Message_Text: meta.firstMessageText } : null;

		if (!metadata) {
			return {
				success: false,
				text:
					targetUser === msg.sender
						? "I haven't processed your messages yet! Try again in a couple of minutes."
						: `That user has not said anything in ${channelArticle} channel!`,
			};
		}

		let { First_Message_Posted: posted, First_Message_Text: text } = metadata;
		if (!posted || !text) {
			if (!targetUser.twitchId) {
				const userArticle = targetUser === msg.sender ? 'You have' : 'That user has';
				return { success: false, text: `${userArticle} no first line data available in ${channelArticle} channel!` };
			}

			const line = await bot.DB.ChatLine.findOne({ channel: targetChannel.id, userId: targetUser.twitchId }).sort({ posted: 1, _id: 1 }).lean();
			const lineData = line ? { Text: line.text, Posted: line.posted } : null;
			if (!lineData) {
				return { success: false, text: `That user has no first line data available in ${channelArticle} channel!` };
			}

			await bot.DB.MessageMetaUserAlias.updateOne(
				{ userAlias: targetUser.id, channel: targetChannel.id },
				{ $set: { firstMessagePosted: lineData.Posted, firstMessageText: lineData.Text } },
			);

			posted = lineData.Posted;
			text = lineData.Text;
		}

		if (msg.params.textOnly) {
			return { text: text };
		}

		const prefix = targetUser.id === msg.sender.id ? 'Your' : "That user's";
		return { text: `${prefix} first message in ${channelArticle} channel according to my data was (${bot.Utils.timeDelta(posted)}): ${text}` };
	},
	dynamicDescription: (prefix) => [
		"Posts the target user's first chat line, according to the bot's data - this might not always be 100% accurate.",
		'',
		`<code>${prefix}firstline</code> / <code>${prefix}fl (user)</code> / <code>${prefix}fl (user) channel:(channel)</code>`,
		`<code>${prefix}fl textOnly:true</code> - only the message, without the date and the command's text.`,
	],
};
