const { listOrLink } = require('../util/list-reply.js');
const { addWatchChannel, listWatchChannels, removeWatchChannel } = require('../util/watch-channels.js');

/**
 * Watch-Channels: Channels, die der Bot ohne Mod-Status mitliest (Mode "Read"), aus sb-v2.
 * Entfernen trifft nur Watch-Channels - wo der Bot Mod ist, bleibt er.
 */
const command = {
	name: 'watch',
	cooldown: { user: 3 },
	access: { channel: 2 },
	description: 'Manage channels the bot reads along in without mod status.',
	usage: 'watch <add|remove|list> [channel]',
	execute: async ({ client, message: msg }) => {
		const [sub, targetRaw] = msg.args;
		const display = msg.displayName;
		const action = sub?.toLowerCase();
		const target = targetRaw
			?.toLowerCase()
			.replace(/^[@#]+/, '')
			.trim();

		if (action === 'list') {
			const list = listWatchChannels().map((i) => i.Name);
			return `@${display}, watch channels (${list.length}): ${list.length > 0 ? await listOrLink(list, 'Watch channels') : 'none'}`;
		} else if ((action !== 'add' && action !== 'remove') || !target) {
			return `@${display}, Usage: ${msg.prefix}${msg.invocation} <add|remove|list> [channel]`;
		}

		if (action === 'add') {
			const result = await addWatchChannel(target);
			if (!result.ok) {
				return result.reason === 'notfound'
							? `@${display}, channel "${target}" not found.`
							: `@${display}, I'm already active in #${result.channel?.name ?? target} (mode ${result.channel?.mode ?? '?'}).`;
			}

			return `@${display}, ${result.channel.name} added to the watch channels (ID: ${result.channel.twitchId}).`;
		}

		const removed = await removeWatchChannel(target);
		return removed ? `@${display}, ${target} removed from the watch channels.` : `@${display}, ${target} is not in the watch channels.`;
	},
};

module.exports = { command };
