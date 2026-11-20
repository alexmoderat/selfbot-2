const { findExtra } = require('../util/channel-manager.js');
const { uploadList } = require('../token/haste.js');

/** Channels, in denen der Bot noch aktiv, aber nicht (mehr) Mod ist - aus sb-v2 */
module.exports = {
	name: 'extrachannels',
	cooldown: 3000,
	description: 'Shows channels the bot is still in but no longer mod in.',
	usage: 'extrachannels',
	flags: ['mod'],
	execute: async (client, msg) => {
		const display = msg.displayName;
		const active = bot.Channels.getJoinable();
		const extra = await findExtra();
		if (!extra) {
			return { text: `@${display}, the moderated channel list from Twitch is unavailable right now.` };
		}

		const modCount = active.length - extra.length;
		if (extra.length === 0) {
			return { text: `@${display}, no discrepancy — live: ${active.length}, mods: ${modCount}` };
		}

		const url = await uploadList(
			'Live-joined but not (or no longer) mod',
			extra.map((i) => `${i.Name} (${i.Mode})`),
		);
		return { text: `@${display}, live: ${active.length}, mods: ${modCount}, discrepancy: ${extra.length}: ${url}` };
	},
};
