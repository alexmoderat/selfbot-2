const { commands } = require('../clients/modules/commands.js');

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
		const missing = await core.Query.getRecordset((rs) =>
			rs // TODO(port)
				.select('Channel')
				.from('selfbot_data', 'Message_Meta_User_Alias')
				.where('User_Alias = %n', userData.id)
				.where('First_Message_Posted IS NULL')
				.flat('Channel'),
		);

		if (missing.length > 0 && userData.twitchId) {
			await Promise.all(
				missing.map(async (channelId) => {
					const channelData = bot.Channels.get(channelId);
					if (!channelData || !(await core.Query.isTablePresent('selfbot_chat_line', channelData.getDatabaseName()))) {
						// TODO(port)
						return;
					}

					const message = await core.Query.getRecordset((rs) =>
						rs // TODO(port)
							.select('Text', 'Posted')
							.from('selfbot_chat_line', channelData.getDatabaseName())
							.where('Platform_ID = %s', userData.twitchId)
							.orderBy('ID ASC')
							.limit(1)
							.single(),
					);
					if (!message) {
						return;
					}

					const row = await core.Query.getRow('selfbot_data', 'Message_Meta_User_Alias'); // TODO(port)
					await row.load({ User_Alias: userData.id, Channel: channelData.id }, true);
					if (row.loaded) {
						row.setValues({ First_Message_Text: message.Text, First_Message_Posted: message.Posted });
						await row.save({ skipLoad: true });
					}
				}),
			);
		}

		const data = await core.Query.getRecordset((rs) =>
			rs // TODO(port)
				.select('Channel', 'First_Message_Posted AS Date', 'First_Message_Text AS Message')
				.from('selfbot_data', 'Message_Meta_User_Alias')
				.where('User_Alias = %n', userData.id)
				.where('First_Message_Posted IS NOT NULL')
				.orderBy('First_Message_Posted ASC')
				.limit(1)
				.single(),
		);

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
