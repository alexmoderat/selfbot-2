const { got } = require('../token/got.js');
const { commands } = require('../clients/modules/commands.js');
const { fetchTwitchUser } = require('../util/twitch/twitch-utils.js');
const { twitchChannelSchema } = require('../misc/schemas.js');

// Supibots commands/shoutout (Block 8: Supibot-Version, alexmoderat 24.10.2026)
module.exports = {
	name: 'shoutout',
	aliases: ['so'],
	cooldown: 30000,
	description: 'Shouts out a given streamer (Twitch only), and posts the last game they played as well.',
	usage: 'shoutout <user>',
	flags: ['mention'],
	execute: async (client, msg) => {
		const [target] = msg.args;
		if (bot.Twitch.name !== 'twitch') {
			return {
				success: false,
				text: 'This command is only usable on Twitch!',
			};
		}
		if (!target) {
			return {
				success: false,
				text: 'No user provided!',
			};
		}

		const cleanUsername = bot.Users.normalizeUsername(target.trim());
		const targetUserId = (await fetchTwitchUser(cleanUsername).catch(() => null))?.id ?? null;
		if (targetUserId && targetUserId === msg.sender.twitchId) {
			return {
				success: false,
				text: "This isn't going to make you any more famous, you got to put the work in yourself!",
			};
		} else if (targetUserId === bot.Twitch.selfId) {
			return {
				success: false,
				text: "Thanks for the effort, but I don't stream! I suggest you use some of my commands instead to make me more popular 🙂",
			};
		} else if (!targetUserId) {
			return {
				success: false,
				text: 'Target user does not exist on Twitch, or is banned!',
			};
		}

		const response = await got('Helix')({
			url: 'channels',
			searchParams: {
				broadcaster_id: targetUserId,
			},
		});

		if (response.statusCode !== 200) {
			return {
				success: false,
				text: `That user doesn't exist or has deactivated their account!`,
			};
		}

		const { broadcaster_login: login, broadcaster_name: name, game_name: game, title } = twitchChannelSchema.parse(response.body).data[0];

		const url = `https://twitch.tv/${login}`;
		const nameString = login.toLowerCase() === name.toLowerCase() ? name : `${name} (${login})`;
		const titleString = title ? ` with title "${title}".` : '.';
		const gameString = game ? `They last streamed in game/category ${game}${titleString}` : '';

		return {
			success: true,
			text: `Shout out to ${nameString}! ${gameString} Check them out here: ${url}`,
		};
	},
};
