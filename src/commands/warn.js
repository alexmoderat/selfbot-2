const { got } = require('../token/got.js');
const { fetchTwitchUser } = require('../util/twitch/twitch-utils.js');

/** Twitch-Verwarnung ueber Helix (aus sb-v2). Helix wirft hier keine Fehler - der Status wird geprueft */
const command = {
	name: 'warn',
	cooldown: { user: 3 },
	access: { channel: 2 },
	description: "Warns a user through Twitch's warning API.",
	usage: 'warn <username> [reason]',
	execute: async ({ client, message: msg }) => {
		const [targetRaw, ...reasonWords] = msg.args;
		const display = msg.displayName;
		const channel = msg.channelData;
		if (!channel?.twitchId) {
			return `@${display}, this only works in a channel.`;
		}

		const target = (targetRaw ?? '').toLowerCase().replace('@', '');
		const reason = reasonWords.join(' ') || 'No reason provided';
		const user = await fetchTwitchUser(target);
		if (!user) {
			return `@${display}, User "${target}" not found.`;
		}

		const response = await got('Helix')({
			method: 'POST',
			url: 'moderation/warnings',
			searchParams: { broadcaster_id: channel.twitchId, moderator_id: bot.Twitch.selfId },
			json: { data: { user_id: user.id, reason } },
		});

		if (!response.ok) {
			return `@${display}, Error ${response.statusCode}: ${response.body.message ?? 'unknown error'}`;
		}

		return `@${display}, ⚠️ ${user.display_name} has been warned · Reason: ${reason}`;
	},
};

module.exports = { command };
