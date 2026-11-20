const { got } = require('../token/got.js');
const SupiDate = require('../util/date.js');
const { ivrUserDataSchema } = require('../util/schemas.js');

// Supibots commands/accountage (Block 7: Supibot-Version, sb-v2s war fast identisch)
module.exports = {
	name: 'accountage',
	aliases: ['accage'],
	cooldown: 15000,
	description: 'Fetches the Twitch account age of a given account. If none is given, checks yours.',
	usage: 'accountage [user]',
	flags: ['mention', 'pipe'],
	execute: async (client, msg) => {
		const [user] = msg.args;
		const login = bot.Users.normalizeUsername(user ?? msg.sender.name).toLowerCase();
		const response = await got('IVR')({
			url: 'v2/twitch/user',
			searchParams: { login },
		});

		const parseResult = ivrUserDataSchema.safeParse(response.body);
		if (response.statusCode !== 200 || parseResult.error || parseResult.data.length === 0) {
			return {
				text: 'That Twitch account has no data associated with them.',
			};
		}

		const creationDate = parseResult.data[0].createdAt;
		const created = new SupiDate(creationDate);

		let anniversary = '';
		const now = new SupiDate();
		const pronoun = login.toLowerCase() === msg.sender.name ? 'Your' : 'Their';
		if (now.year > created.year && now.month === created.month && now.day === created.day) {
			const who = login === bot.Twitch.selfName ? 'my' : pronoun.toLowerCase();

			anniversary = `It's ${who} ${now.year - created.year}. Twitch anniversary! FeelsBirthdayMan Clap`;
		}

		const delta = bot.Utils.timeDelta(created, false, true);
		return {
			text: `${pronoun} Twitch account was created ${delta}. ${anniversary}`,
		};
	},
};
