const z = require('zod');
const { got } = require('../token/got.js');
const { getTwitchGameID } = require('./command-utils.js');
const { twitchStreamSchema } = require('./schemas.js');

/**
 * Beliebteste Kategorien und Streams auf Twitch (aus den Commands topgames/topstreams, Supibot-Version), als Daten fuer die
 * Variablen {top_games} und {ts_*} der Custom Commands. ts_kind: nogame | empty | ok.
 */
const querySchema = z.array(
	z.object({
		data: z.object({
			directoriesWithTags: z.object({
				edges: z.array(z.object({ node: z.object({ displayName: z.string(), id: z.string(), name: z.string(), slug: z.string(), viewersCount: z.int() }) })),
			}),
		}),
	}),
);

/** "Just Chatting (123k), Fortnite (80k), ..." - Top 10 nach Zuschauern */
const getTopGames = async () => {
	const response = await got('TwitchGQL')({
		url: 'gql',
		responseType: 'json',
		body: JSON.stringify([
			{
				operationName: 'BrowsePage_AllDirectories',
				extensions: { persistedQuery: { version: 1, sha256Hash: '2f67f71ba89f3c0ed26a141ec00da1defecb2303595f5cda4298169549783d9e' } },
				variables: { limit: 10, tags: [], options: { sort: 'VIEWER_COUNT' } },
			},
		]),
	});

	return querySchema
		.parse(response.body)[0]
		.data.directoriesWithTags.edges.map(({ node }) => `${node.displayName} (${Math.floor(node.viewersCount / 1000)}k)`)
		.join(', ');
};

/** Top 10 Streams, mit Kategorie wie angegeben (Name muss exakt stimmen); "@login - Spiel (Zuschauer); ..." */
const getTopStreams = async (gameName) => {
	// Supibot schickt "limit", das Helix nicht kennt (liefert dann 20) - "first" ist der echte Parameter
	const searchParams = { first: '10' };
	if (gameName) {
		const game = (await getTwitchGameID(gameName)).at(0);
		if (!game) {
			return { kind: 'nogame' };
		}
		searchParams.game_id = game.id;
	}

	const response = await got('Helix')({ url: 'streams', searchParams });
	const { data } = twitchStreamSchema.parse(response.body);
	if (!response.ok || data.length === 0) {
		return { kind: 'empty' };
	}

	const list = data.map((stream) => `@${stream.user_login} ${searchParams.game_id ? '' : `- ${stream.game_name}`} (${bot.Utils.groupDigits(stream.viewer_count)})`).join('; ');
	return { kind: 'ok', list };
};

module.exports = { getTopGames, getTopStreams };
