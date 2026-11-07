const { got } = require('../token/got.js');
const { commands } = require('../clients/modules/commands.js');
const { ivrUserDataSchema } = require('../misc/schemas.js');

// Supibots commands/getprofilepicture (Block 7: Supibot-Version)
module.exports = {
	name: 'getprofilepicture',
	aliases: ['avatar', 'pfp'],
	cooldown: 10000,
	description: 'For a given Twitch user, this command will fetch their profile picture.',
	usage: 'pfp [user] [banner:true] [linkOnly:true]',
	flags: ['mention', 'pipe'],
	params: [
		{ name: 'banner', type: 'boolean' },
		{ name: 'linkOnly', type: 'boolean' },
	],
	execute: async (client, msg) => {
		const [username] = msg.args;
		const login = bot.Users.normalizeUsername(username ?? msg.sender.name);
		const response = await got('IVR')({
			url: 'v2/twitch/user',
			searchParams: { login },
		});

		if (!response.ok) {
			return {
				success: false,
				text: `No such user found!`,
			};
		}

		const user = ivrUserDataSchema.parse(response.body).at(0);
		if (!user) {
			return {
				success: false,
				text: `No such user found!`,
			};
		}

		if (msg.params.banner === true) {
			if (user.banner === null) {
				return {
					success: false,
					text: msg.params.linkOnly === true ? 'N/A' : `User ${user.displayName} has no profile banner set up!`,
				};
			}

			return {
				text: msg.params.linkOnly === true ? user.banner : `Profile banner for ${user.displayName}: ${user.banner}`,
			};
		}

		return {
			text: msg.params.linkOnly ? user.logo : `Profile picture for ${user.displayName}: ${user.logo}`,
		};
	},
	dynamicDescription: (prefix) => [
		"Fetches a Twitch user's profile picture, or other pictures related to their account.",
		'',
		`<code>${prefix}pfp (user)</code>`,
		"Posts the user's profile picture.",
		'',
		`<code>${prefix}pfp <u>linkOnly:true</u> (user)</code>`,
		'Post only the link to the picture, with no other text describing it.',
		'',
		`<code>${prefix}pfp <u>banner:true</u> (user)</code>`,
		"Post the user's profile banner, if they have one set up. If they don't have one, a message describing that will appear instead.",
		'',
		`<code>${prefix}pfp <u>banner:true</u> <u>linkOnly:true</u> (user)</code>`,
		`Post only the link to the user's profile banner. If they don't have one, the message "N/A" will show up.`,
	],
};
