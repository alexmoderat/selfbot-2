const { listOrLink } = require('../util/list-reply.js');
const { addWatchChannel, listWatchChannels, removeWatchChannel } = require('../util/watch-channels.js');

/**
 * Alte Aufrufe addwatch / removewatch / listwatch aus sb-v2. Dort schrieben sie in data/watch-channels.json, die seit
 * dem Umbau niemand mehr las ("Bot restart required" ohne Wirkung) - hier verwalten sie dieselben Watch-Channels
 * wie !watch, wirken also sofort.
 */
module.exports = {
	name: 'watchban',
	aliases: ['addwatch', 'removewatch', 'listwatch'],
	cooldown: 3000,
	description: 'Manage the watch list (channels that are additionally observed).',
	usage: 'addwatch <channel> | removewatch <channel> | listwatch',
	flags: ['owner'],
	execute: async (client, msg) => {
		const [arg1, arg2] = msg.args;
		const display = msg.displayName;
		// Aufruf ueber Alias bestimmt die Aktion; ueber den Hauptnamen kommt sie als Argument
		const action = msg.invocation === 'watchban' ? arg1?.toLowerCase() : msg.invocation === 'addwatch' ? 'add' : msg.invocation === 'removewatch' ? 'remove' : 'list';
		const target = (msg.invocation === 'watchban' ? arg2 : arg1)?.toLowerCase().replace(/^[@#]+/, '');

		if (action === 'list') {
			const list = listWatchChannels().map((i) => i.Name);
			return {
				text: list.length === 0 ? `@${display} The watch list is empty.` : `@${display} Watch list (${list.length}): ${await listOrLink(list, 'Watch list')}`,
			};
		} else if (action !== 'add' && action !== 'remove') {
			return { text: `@${display} Usage: addwatch <channel> | removewatch <channel> | listwatch` };
		} else if (!target) {
			return { text: `@${display} No channel given.` };
		}

		if (action === 'add') {
			const result = await addWatchChannel(target);
			if (!result.ok) {
				return {
					text: result.reason === 'notfound' ? `@${display} Channel ${target} not found.` : `@${display} ${target} is already active (mode ${result.channel?.mode ?? '?'}).`,
				};
			}

			return { text: `@${display} ✅ ${result.channel.name} added to the watch list.` };
		}

		return {
			text: (await removeWatchChannel(target)) ? `@${display} ✅ ${target} removed from the watch list.` : `@${display} ${target} is not on the watch list.`,
		};
	},
};
