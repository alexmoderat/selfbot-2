const { got } = require('../token/got.js');
const { getTwitchGameID } = require('../misc/command-utils.js');
const { twitchStreamSchema } = require('../misc/schemas.js');

// Supibots commands/topstreams (Block 7: Supibot-Version)
module.exports = {
	name: 'topstreams',
	cooldown: 30000,
	description:
		'Checks the top 10 streams on Twitch - if you add a game, will look for the top 10 streams playing that game. The game must be provided verbatim.',
	usage: 'topstreams [game]',
	flags: ['mention', 'pipe'],
	execute: async (client, msg) => {
		const args = [...msg.args];
		// Supibot schickt "limit", das Helix nicht kennt (liefert dann 20) - "first" ist der echte Parameter
		const searchParams = { first: '10' };
		if (args.length > 0) {
			const games = await getTwitchGameID(args.join(' '));
			const game = games.at(0);
			if (!game) {
				return {
					success: false,
					text: `Provided game is not available on Twitch! You must use an exact match.`,
				};
			}

			searchParams.game_id = game.id;
		}

		const response = await got('Helix')({
			url: 'streams',
			searchParams,
		});

		const { data } = twitchStreamSchema.parse(response.body);
		if (!response.ok || data.length === 0) {
			return {
				text: 'game_id' in searchParams ? 'Nobody is playing that game right now.' : 'Nobody is playing anything on Twitch right now. (?!)',
			};
		}

		// Supibot prueft hier searchParams.game (nie gesetzt) - die Antwort ist dadurch immer "are live", so belassen
		const gameString = 'are live';
		const streamers = data.map((stream) => {
			const specificGame = !searchParams.game_id ? `- ${stream.game_name}` : '';

			return `@${stream.user_login} ${specificGame} (${bot.Utils.groupDigits(stream.viewer_count)})`;
		});

		return {
			text: `These streamers ${gameString}: ${streamers.join('; ')}`,
		};
	},
};
