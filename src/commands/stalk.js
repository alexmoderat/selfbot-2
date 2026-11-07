const { got } = require('../token/got.js');
const { commands } = require('../clients/modules/commands.js');

const { ivrUserDataSchema } = require('../misc/schemas.js');

// Supibots commands/stalk (ninou2, 07.11.2026: "for command like staking ... use the same command as spBot").
// Supibots Banphrase-Pruefung der Teilantworten gibt es hier nicht (Block 2), daher eine einfache Antwort.
// Datenbasis sind die Channels dieses Bots - Supibot sitzt in mehr Channels und sieht Leute daher oft spaeter.
const omittedBanReasons = new Set(['TOS_TEMPORARY', 'TOS_INDEFINITE']);

module.exports = {
	name: 'stalk',
	cooldown: 5000,
	description: 'For a given user, attempts to find the message they last sent in chat, plus the channel and time when they posted it.',
	usage: 'stalk <user>',
	flags: ['block', 'external-input', 'mention', 'opt-out', 'pipe'],
	execute: async (client, msg) => {
		const [user] = msg.args;
		if (!user) {
			const emote = await msg.getBestAvailableEmote(['forsen1'], '👀');
			return { success: false, text: `${emote} I'm watching you... (no user provided!)` };
		}

		const targetUser = await bot.Users.get(user);
		if (!targetUser) {
			return { success: false, text: 'User not found in the database!' };
		} else if (targetUser.id === msg.sender.id && msg.channelData) {
			const emote = await msg.getBestAvailableEmote(['forsen1'], '👀');
			return { success: false, text: `${emote} You're right here ${emote}` };
		} else if (targetUser.name === bot.Twitch.selfName) {
			const emote = await msg.getBestAvailableEmote(['MrDestructoid'], '🤖');
			return { success: false, text: `${emote} I'm right here ${emote}` };
		}

		const stalkData = await core.Query.getRecordset((rs) =>
			rs // TODO(port)
				.select('Last_Message_Text AS Text', 'Last_Message_Posted AS Date', 'Channel AS ChannelID')
				.from('selfbot_data', 'Message_Meta_User_Alias')
				.where('User_Alias = %n', targetUser.id)
				.orderBy('Last_Message_Posted DESC')
				.limit(1)
				.single(),
		);

		if (!stalkData) {
			return {
				text: `That user is in the database, but never showed up in chat. They were first spotted ${bot.Utils.timeDelta(targetUser.Started_Using)}.`,
			};
		}

		const stalkChannelData = bot.Channels.get(stalkData.ChannelID);
		if (!stalkChannelData) {
			return { success: false, text: "That user's last message was in a channel I'm no longer in." };
		}

		// Supibot: gesperrte Twitch-Accounts (TOS) in Twitch-Channels nicht stalken, schuetzt den Bot vor Bans
		if (targetUser.twitchId && msg.channelData) {
			const response = await got('IVR')({
				url: 'v2/twitch/user',
				searchParams: { id: targetUser.twitchId },
			});

			const userInfo = ivrUserDataSchema.safeParse(response.body).data?.at(0);
			if (userInfo && userInfo.banned && omittedBanReasons.has(userInfo.banReason)) {
				return { success: false, text: "You cannot stalk that user as they're currently banned on Twitch!" };
			}
		}

		const who = msg.sender === targetUser ? 'You were' : 'That user was';
		return {
			text: `${who} last seen in chat ${bot.Utils.timeDelta(stalkData.Date)} (${stalkChannelData.getFullName()}) Last message: ${stalkData.Text}`,
		};
	},
};
