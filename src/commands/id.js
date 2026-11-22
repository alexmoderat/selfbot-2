const SupiDate = require('../util/date.js');

// Supibots USER_ID_BREAKPOINT (User aus Logs vor Supibots Start) entfaellt hier: die Datenbank ist neu
const command = {
	name: 'id',
	aliases: ['uid'],
	cooldown: { user: 10 },
	access: { channel: 0 },
	description: "Checks your (or someone else's) ID in the database of users - the lower the number, the earlier the user was first spotted.",
	usage: 'id [user]',
	flags: ['mention', 'pipe', 'skip-banphrase'],
	execute: async ({ client, message: msg }) => {
		const [user] = msg.args;
		const targetUser = user ? await bot.Users.get(user) : msg.sender;
		if (!targetUser) {
			return {
				success: false,
				text: 'No data for given user name!',
			};
		}

		let idString = "That user's ID is";
		let pronoun = 'they were';
		if (targetUser.id === msg.sender.id) {
			idString = 'Your ID is';
			pronoun = 'you were';
		}

		let temporalReply = 'first seen';
		if (targetUser.name === bot.Twitch.selfName) {
			temporalReply = 'first brought to life as a bot';
		}

		const delta = bot.Utils.timeDelta(targetUser.Started_Using);
		const now = new SupiDate();
		const { year, month, day } = new SupiDate(targetUser.Started_Using);

		let birthdayString = '';
		if (now.year > year && now.month === month && now.day === day) {
			const birthdayFace = await msg.getBestAvailableEmote(['FeelsBirthdayMan'], '🥳');
			if (targetUser.name === bot.Twitch.selfName) {
				const robotFace = await msg.getBestAvailableEmote(['MrDestructoid'], '🤖');
				birthdayString = `It's my birthday! ${birthdayFace} ${robotFace}`;
			} else {
				const who = targetUser === msg.sender ? 'your' : 'their';
				const sideEmote = await msg.getBestAvailableEmote(['Clap'], '🎈');
				birthdayString = `It's ${who} account's ${now.year - year}. anniversary in my database! ${birthdayFace} ${sideEmote}`;
			}
		}

		const platformIdString = targetUser.twitchId ? `Twitch ID: ${targetUser.twitchId}` : '';
		return {
			success: true,
			text: `${idString} ${targetUser.id} and ${pronoun} ${temporalReply} ${delta}. ${platformIdString} ${birthdayString}`,
		};
	},
};

module.exports = { command };
