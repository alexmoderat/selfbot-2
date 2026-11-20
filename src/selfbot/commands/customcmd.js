const customCommands = require('../util/custom-commands.js');
const { uuidPrefix } = require('../util/moderation-phrases.js');

/**
 * Custom Commands verwalten, aus sb-v2 (Ausfuehrung: singletons/custom-commands.ts). Aenderungen wirken sofort.
 */
const describe = (row) => {
	const flags = [];
	if (row.Mod_Only) {
		flags.push('mod-only');
	}
	if (row.Reply) {
		flags.push('reply');
	}
	if (row.Online_Only) {
		flags.push('online-only');
	}
	if (row.Offline_Only) {
		flags.push('offline-only');
	}
	if (row.Cooldown !== 5) {
		flags.push(`cd:${row.Cooldown}s`);
	}

	return `${row.Name}${flags.length > 0 ? ` [${flags.join(', ')}]` : ''}`;
};

module.exports = {
	name: 'customcmd',
	aliases: ['customcmds', 'cc'],
	cooldown: 3000,
	description: 'Create, edit, delete and list your own per-channel chat commands.',
	usage: 'customcmd <add|edit|remove|list|modonly> !name [reply] [cooldown:5] [text:true] [modonly:true] [online:true] [offline:true]',
	// Loeschen nur nach zweiter Bestaetigung (ninou2, 06.10.2026)
	flags: ['mod', 'confirm'],
	params: [
		{ name: 'cooldown', type: 'number' },
		{ name: 'reply', type: 'boolean' },
		{ name: 'modonly', type: 'boolean' },
		{ name: 'online', type: 'boolean' },
		{ name: 'offline', type: 'boolean' },
	],
	execute: async (client, msg) => {
		const [sub, nameRaw, ...responseWords] = msg.args;
		const display = msg.displayName;
		const channel = msg.channelData;
		if (!channel) {
			return { text: `@${display}, this only works in a channel.` };
		}

		const action = sub?.toLowerCase();
		const name = nameRaw?.toLowerCase();
		const p = msg.params;
		const options = {
			...(p.cooldown !== undefined ? { Cooldown: Math.max(0, Math.trunc(p.cooldown) || 5) } : {}),
			...(p.reply !== undefined ? { Reply: p.reply } : {}),
			...(p.modonly !== undefined ? { Mod_Only: p.modonly } : {}),
			...(p.online !== undefined ? { Online_Only: p.online } : {}),
			...(p.offline !== undefined ? { Offline_Only: p.offline } : {}),
		};

		if (action === 'list') {
			const list = await customCommands.list(channel);
			if (list.length === 0) {
				return { text: `@${display}, no custom commands in #${channel.name}.` };
			}

			return { text: `@${display}, ${list.length} command(s) in #${channel.name}: ${list.map(describe).join(' · ')}` };
		} else if (!['add', 'edit', 'remove', 'delete', 'modonly'].includes(action ?? '')) {
			return { text: `@${display}, Usage: ${msg.prefix}${msg.invocation} <add|edit|remove|list|modonly> !name [reply] [flags]` };
		} else if (!name) {
			return { text: `@${display}, Usage: ${msg.prefix}${msg.invocation} ${action} !name …` };
		}

		if (action === 'add') {
			if (!name.startsWith('!')) {
				return { text: `@${display}, command name must start with "!" (e.g. !discord).` };
			}

			const response = responseWords.join(' ').trim();
			if (!response) {
				return { text: `@${display}, please provide a response.` };
			} else if (await customCommands.get(channel, name)) {
				return { text: `@${display}, command ${name} already exists. Use "edit" to change it.` };
			}

			const uuid = await customCommands.add(channel, name, response, options);
			return { text: `@${display}, ✅ command ${name} added. (ID: ${uuid})` };
		}

		if (action === 'edit') {
			const existing = await customCommands.get(channel, name);
			if (!existing) {
				return { text: `@${display}, command ${name} not found.` };
			}

			await customCommands.edit(existing, responseWords.join(' ').trim() || existing.Response, options);
			return { text: `@${display}, ✅ command ${name} updated.` };
		}

		if (action === 'modonly') {
			const existing = await customCommands.get(channel, name);
			if (!existing) {
				return { text: `@${display}, command ${name} not found.` };
			}

			await customCommands.edit(existing, existing.Response, { Mod_Only: !existing.Mod_Only });
			return { text: `@${display}, ✅ ${name} is now ${existing.Mod_Only ? 'for everyone' : 'mod-only'}.` };
		}

		// Loeschen per Name oder Kurz-ID
		const prefix = name.startsWith('!') ? null : uuidPrefix(name);
		const list = await customCommands.list(channel);
		const byId = prefix ? list.filter((i) => i.UUID.startsWith(prefix)) : [];
		const existing = byId.length === 1 ? byId[0] : await customCommands.get(channel, name);
		if (!existing) {
			return { text: `@${display}, command "${name}" not found.` };
		}

		await customCommands.remove(existing);
		return { text: `@${display}, ✅ command ${existing.Name} deleted. (ID: ${existing.UUID})` };
	},
};
