const { got } = require('../token/got.js');
const z = require('zod');

// Supibots commands/topgames (Block 7: Supibot-Version)
const querySchema = z.array(
	z.object({
		data: z.object({
			directoriesWithTags: z.object({
				edges: z.array(
					z.object({
						node: z.object({
							displayName: z.string(),
							id: z.string(),
							name: z.string(),
							slug: z.string(),
							viewersCount: z.int(),
						}),
					}),
				),
			}),
		}),
	}),
);

module.exports = {
	name: 'topgames',
	cooldown: 30000,
	description: 'Fetches the top 10 most popular games on Twitch, based on current viewer count.',
	usage: 'topgames',
	flags: ['mention', 'pipe'],
	execute: async (client, msg) => {
		const response = await got('TwitchGQL')({
			url: 'gql',
			responseType: 'json',
			body: JSON.stringify([
				{
					operationName: 'BrowsePage_AllDirectories',
					extensions: {
						persistedQuery: {
							version: 1,
							sha256Hash: '2f67f71ba89f3c0ed26a141ec00da1defecb2303595f5cda4298169549783d9e',
						},
					},
					variables: {
						limit: 10,
						tags: [],
						options: {
							sort: 'VIEWER_COUNT',
						},
					},
				},
			]),
		});

		const games = querySchema.parse(response.body)[0].data.directoriesWithTags.edges;
		const string = games
			.map(({ node }) => {
				const shortNumber = `${Math.floor(node.viewersCount / 1000)}k`;
				return `${node.displayName} (${shortNumber})`;
			})
			.join(', ');

		return {
			success: true,
			text: `Current top categories on Twitch: ${string}`,
		};
	},
};
