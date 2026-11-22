const { listOrLink } = require('../util/list-reply.js');

const { listSuspended, reactivateChannel } = require('../util/channel-suspension.js');
const { getBanStatusBatch } = require('../token/gql.js');

/**
 * Prueft die wegen Sperre verlassenen Channels von Hand nach, aus sb-v2: ein GQL-Batch, und wer wieder aktiv ist,
 * wird gleich wieder betreten (vorheriger Mode).
 */
const command = {
	name: 'checksuspended',
	cooldown: { user: 3 },
	access: { channel: 2 },
	description: 'Re-checks channels marked as suspended and rejoins reactivated ones.',
	usage: 'checksuspended',
	execute: async ({ client, message: msg }) => {
		const display = msg.displayName;
		const platform = bot.Twitch;
		const list = await listSuspended(platform);
		if (list.length === 0) {
			return `@${display}, no banned channels recorded.`;
		}

		let status;
		try {
			status = await getBanStatusBatch(list.map((i) => i.channel.name));
		} catch {
			return `@${display}, the Twitch lookup failed, please try again later.`;
		}

		const revived = [];
		for (const { channel } of list) {
			const info = status.get(channel.name);
			if (info && !info.banned && (await reactivateChannel(channel, platform))) {
				revived.push(channel.name);
			}
		}

		if (revived.length === 0) {
			return `@${display}, checked ${list.length} channel(s), all still banned.`;
		}

		return `@${display}, checked ${list.length} · active again: ${revived.length > 0 ? await listOrLink(revived, 'Reactivated channels') : 'none'} · still banned: ${list.length - revived.length}`;
	},
};

module.exports = { command };
