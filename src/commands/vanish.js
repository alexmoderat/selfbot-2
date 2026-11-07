const { MODERATOR_BADGES } = require('../misc/text-analysis.js');
const { banUser, targetFromChannel } = require('../services/moderation.js');

module.exports = {
	name: 'vanish',
	aliases: ['v'],
	cooldown: 60000,
	description: 'Twitch only: times the user out for 1 second. Only works if the bot is a Twitch moderator.',
	usage: 'vanish',
	flags: ['no-prefix', 'skip-banphrase'],
	execute: async (client, msg) => {
		if (bot.Twitch.name !== 'twitch') {
			return {
				success: false,
				text: 'You cannot vanish outside of Twitch!',
			};
		} else if (msg.channelData === null) {
			return {
				success: false,
				text: 'Vanishing is impossible in private messages!',
			};
		} else if (msg.channelData.mode !== 'Moderator') {
			return {
				success: false,
				text: "I cannot make you vanish here, as I'm not a moderator!",
			};
		}

		const badges = new Set((msg.user.badges ?? []).map((i) => i.set_id));
		if ([...MODERATOR_BADGES].some((i) => badges.has(i))) {
			return {
				success: false,
				text: 'I cannot time moderators out! monkaS',
			};
		} else if (badges.has('broadcaster')) {
			const emote = await msg.getBestAvailableEmote(['PepeLaugh', 'pepeLaugh', 'LuL'], '😄');
			return {
				success: false,
				text: `Why are you trying to vanish in your own channel? ${emote}`,
			};
		} else if (badges.has('staff')) {
			return {
				success: false,
				text: 'I cannot time Twitch staff out! monkaS',
			};
		}

		const ok = msg.sender.twitchId
			? await banUser(targetFromChannel(msg.channelData, msg.sender.twitchId, msg.sender.name), { reason: 'Vanished', duration: 1, skipLog: true })
			: false;

		if (!ok) {
			const emote = await msg.getBestAvailableEmote(['LULE', 'LULW', 'LuL', 'LUL'], '😄');
			return {
				success: false,
				text: `Could not time you out, because Twitch said nothing and left! ${emote}`,
			};
		}

		return {
			success: true,
			text: null,
		};
	},
};
