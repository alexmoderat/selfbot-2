const { streamData } = require('../services/stream-tracking.js');
const { fmtDate } = require('../misc/streamer-streak.js');

/**
 * Welche Channels schon Stunden-/Kategorie-Daten haben (Liste als Haste) oder ob ein Channel getrackt wird, aus sb-v2
 * (ninou2, 15.10.2026). Nur lesend - "add"/"remove" verweisen auf !streaktrack (alexmoderat, 20.10.2026).
 */
module.exports = {
	name: 'streamertrack',
	aliases: ['strack'],
	cooldown: 3000,
	description: 'List which channels already have tracked stream hours (!hs/!hsc), or check a single channel.',
	usage: 'streamertrack [list | channel]',
	execute: async (client, msg) => {
		const [arg] = msg.args;
		const display = msg.displayName;
		const sub = arg?.toLowerCase();
		if (!arg || sub === 'list') {
			const channels = await streamData.getTrackedChannels();
			if (channels.length === 0) {
				return { text: `@${display}, no channels tracked yet.` };
			}

			const url = await streamData.uploadList('Tracked channels (stream hours)', channels);
			return { text: `@${display}, tracking ${channels.length} channels: ${url}` };
		} else if (sub === 'add' || sub === 'remove') {
			return {
				text: `@${display}, streamertrack is read-only (list or a single channel) — for add/remove, use !streaktrack (!st) add/remove <channel> instead.`,
			};
		}

		const channel = arg.replace(/^[@#]+/, '').toLowerCase();
		const userId = await streamData.fetchUserId(channel);
		if (!userId) {
			return { text: `@${display}, no Twitch account named "${channel}" exists.` };
		}

		const firstSeen = await streamData.getFirstSeen(userId);
		return { text: firstSeen ? `@${display}, ${channel} is tracked (since ${fmtDate(firstSeen)}).` : `@${display}, ${channel} isn't tracked.` };
	},
};
