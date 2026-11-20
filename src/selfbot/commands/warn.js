const { got } = require('../token/got.js');
const { fetchTwitchUser } = require('../util/twitch/twitch-utils.js');

/** Twitch-Verwarnung ueber Helix (aus sb-v2). Helix wirft hier keine Fehler - der Status wird geprueft */
module.exports = {
	name: 'warn',
	cooldown: 3000,
	description: "Warns a user through Twitch's warning API.",
	usage: 'warn <username> [reason]',
	flags: ['mod'],
	execute: async (client, msg) => {
		const [targetRaw, ...reasonWords] = msg.args;
		const display = msg.displayName;
		const channel = msg.channelData;
		if (!channel?.twitchId) {
			return { text: `@${display}, this only works in a channel.` };
		}

		const target = (targetRaw ?? '').toLowerCase().replace('@', '');
		const reason = reasonWords.join(' ') || 'No reason provided';
		const user = await fetchTwitchUser(target);
		if (!user) {
			return { text: `@${display}, User "${target}" not found.` };
		}

		const response = await got('Helix')({
			method: 'POST',
			url: 'moderation/warnings',
			searchParams: { broadcaster_id: channel.twitchId, moderator_id: bot.Twitch.selfId },
			json: { data: { user_id: user.id, reason } },
		});

		if (!response.ok) {
			return { text: `@${display}, Error ${response.statusCode}: ${response.body.message ?? 'unknown error'}` };
		}

		return { text: `@${display}, ⚠️ ${user.display_name} has been warned · Reason: ${reason}` };
	},
};
