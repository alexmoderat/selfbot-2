// Supibots commands/firstseen: erste Nachricht ueber alle Channels laut Message_Meta_User_Alias
module.exports = {
	name: 'firstseen',
	aliases: ['fs'],
	cooldown: 10000,
	description: 'For a given user, this command tells you when they were first seen in chat - based on chat logs, so it might not be 100% accurate.',
	usage: 'firstseen [user]',
	flags: ['block', 'mention', 'opt-out', 'pipe'],
	execute: async (client, msg) => {
		const [user] = msg.args;
		const userData = user ? await bot.Users.get(user) : msg.sender;
		if (!userData) {
			return { success: false, text: `Provided user does not exist!` };
		}

		// Fehlende erste Nachrichten aus den Log-Tabellen nachtragen (wie Supibot)
		const missing = await bot.DB.MessageMetaUserAlias.distinct('channel', { userAlias: userData.id, firstMessagePosted: null });

		if (missing.length > 0 && userData.twitchId) {
			await Promise.all(
				missing.map(async (channelId) => {
					const channelData = bot.Channels.get(channelId);
					if (!channelData) {
						return;
					}

					const message = await bot.DB.ChatLine.findOne({ channel: channelData.id, userId: userData.twitchId }).sort({ posted: 1, _id: 1 }).lean();
					if (!message) {
						return;
					}

					await bot.DB.MessageMetaUserAlias.updateOne({ userAlias: userData.id, channel: channelData.id }, { $set: { firstMessageText: message.text, firstMessagePosted: message.posted } });
				}),
			);
		}

		const first = await bot.DB.MessageMetaUserAlias.findOne({ userAlias: userData.id, firstMessagePosted: { $ne: null } })
			.sort({ firstMessagePosted: 1 })
			.lean();
		const data = first ? { Channel: first.channel, Date: first.firstMessagePosted, Message: first.firstMessageText } : null;

		if (!data) {
			return {
				success: true,
				text: `I recognize that user, but they have never said anything in chat. I first spotted them ${bot.Utils.timeDelta(userData.Started_Using)}.`,
			};
		}

		const channelData = bot.Channels.get(data.Channel);
		const who = userData === msg.sender ? 'you' : 'that user';
		const belongsTo = userData === msg.sender ? 'your' : 'their';
		return {
			success: true,
			text: `I first saw ${who} in chat ${bot.Utils.timeDelta(data.Date)}, (${channelData?.getFullName() ?? 'unknown channel'}) ${belongsTo} message: ${data.Message}`,
		};
	},
	dynamicDescription: (prefix) => [
		"Posts your (or someone else's) first ever chat line across all channels the bot is active in, according to its data.",
		'',
		`<code>${prefix}firstseen</code> / <code>${prefix}fs (user)</code>`,
	],
};
