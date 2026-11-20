const { streamData } = require('../util/stream-tracking.js');
const { ordinal } = require('../util/streamer-streak.js');

/** "10th sep 2026" (ninou2, 29.09.2026) */
const fmtAddedAt = (addedAt) => {
	const d = new Date(addedAt);
	const month = d.toLocaleDateString('en-US', { month: 'short', timeZone: 'UTC' }).toLowerCase();
	return `${ordinal(d.getUTCDate())} ${month} ${d.getUTCFullYear()}`;
};

/**
 * Channels, die der Cron streamer-streak zusaetzlich per Helix pollt (ohne Join/Mod), aus sb-v2. Fuer alle (alexmoderat,
 * 29.09.2026: "können ruhig alle"), mit "!" aufrufbar (ninou2, 06.10.2026). Existenz wird geprueft - sonst landete jeder
 * Tippfehler in der Liste und nichts wuerde je getrackt.
 */
module.exports = {
	name: 'streaktrack',
	aliases: ['st'],
	cooldown: 3000,
	description: 'Manage extra channels the streak tracker follows.',
	usage: 'streaktrack add <channel> | remove <channel> | list',
	flags: ['no-prefix'],
	execute: async (client, msg) => {
		const [sub, target] = msg.args;
		const display = msg.displayName;
		const action = sub?.toLowerCase();

		if (action === 'list') {
			const entries = await streamData.listExtraChannels();
			if (entries.length === 0) {
				return { text: `@${display}, no extra channels tracked.` };
			}

			const url = await streamData.uploadList(
				'Extra tracked channels (streamer streak)',
				entries.map((i) => `${i.channel} ( added by ${i.addedBy} on ${fmtAddedAt(i.addedAt)} )`),
			);
			return { text: `@${display}, tracking ${entries.length} extra: ${url}` };
		} else if (action !== 'add' && action !== 'remove') {
			return { text: `@${display}, Usage: ${msg.prefix}${msg.invocation} add <channel> | remove <channel> | list` };
		}

		const channel = target
			?.replace(/^[@#]+/, '')
			.toLowerCase()
			.trim();
		if (!channel) {
			return { text: `@${display}, Usage: ${msg.prefix}${msg.invocation} ${action} <channel>` };
		}

		const id = await streamData.fetchUserId(channel);
		if (action === 'remove') {
			const removed = await streamData.removeExtraChannel(id, channel);
			return { text: `@${display}, ${removed ? `${channel} removed from extra tracking.` : `${channel} wasn't in the extra tracking list.`}` };
		} else if (!id) {
			return { text: `@${display}, no Twitch account named "${channel}" exists.` };
		}

		const { existed, addedAt } = await streamData.addExtraChannel(id, channel, msg.sender.name);
		const since = `(started tracking on ${fmtAddedAt(addedAt)})`;
		return {
			text: existed ? `@${display}, ${channel} is already being tracked. ${since}` : `@${display}, now tracking ${channel}'s streaming streak. ${since}`,
		};
	},
};

Object.assign(module.exports, { fmtAddedAt });
