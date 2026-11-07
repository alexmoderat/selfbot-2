const triggers = require('../services/trigger-commands.js');
const { uuidPrefix } = require('../services/moderation-phrases.js');
const { uploadToHaste } = require('../misc/haste.js');

/**
 * Trigger-Commands verwalten, aus sb-v2s triggercommands (Ausfuehrung: Chat-Modul trigger-commands).
 * trigger:wort|phrase (ohne Regex, exact:true fuer die ganze Nachricht) oder trigger:/pattern/flags.
 */
const describe = (row) =>
	JSON.stringify(
		{
			id: row.UUID,
			trigger: row.Pattern,
			response: row.Response,
			cooldown: row.Cooldown,
			mod_only: row.Mod_Only,
			online_only: row.Online_Only,
			offline_only: row.Offline_Only,
			text: row.Reply,
			whitelist: triggers.parseWhitelist(row.Whitelist),
			global_cooldown: row.Global_Cooldown,
			created_at: new Date(row.Created.valueOf()).toISOString(),
		},
		null,
		2,
	);

module.exports = {
	name: 'addcmd',
	aliases: ['rmcmd', 'removecmd', 'listcmd'],
	cooldown: 3000,
	description:
		'Manage trigger commands: trigger:word/phrase (no regex needed, exact:true for a full-message match) or trigger:/pattern/flags for advanced regex.',
	usage: 'addcmd trigger:word|/pattern/ <reply> [exact:true] [cooldown:5] [modonly:true] [whitelist:id1,id2] [global:true] [text:true] [channel:name] | rmcmd <id> [channel:name] | listcmd [channel:name]',
	flags: ['mod'],
	params: [
		{ name: 'trigger', type: 'string' },
		{ name: 'exact', type: 'boolean' },
		{ name: 'cooldown', type: 'number' },
		{ name: 'modonly', type: 'boolean' },
		{ name: 'online', type: 'boolean' },
		{ name: 'offline', type: 'boolean' },
		{ name: 'reply', type: 'boolean' },
		{ name: 'whitelist', type: 'string' },
		{ name: 'channel', type: 'string' },
		{ name: 'global', type: 'boolean' },
	],
	execute: async (client, msg) => {
		const args = [...msg.args];
		const display = msg.displayName;
		const p = msg.params;
		const mode = msg.invocation;

		// listcmd: ohne channel: darf auch ein nacktes Wort den Channel angeben
		const channelName = String(p.channel ?? (mode === 'listcmd' ? args[0] : null) ?? msg.channelData?.name ?? '')
			.replace(/^#+/, '')
			.toLowerCase();
		const channel = bot.Channels.get(channelName);
		if (!channel) {
			return { text: `@${display}, I'm not in #${channelName || '?'}.` };
		}

		if (mode === 'listcmd') {
			const rows = await triggers.list(channel.id);
			if (rows.length === 0) {
				return { text: `@${display}, No trigger commands in #${channel.name}.` };
			}

			try {
				const url = await uploadToHaste(`Trigger commands for #${channel.name}:\n\n[\n${rows.map(describe).join(',\n')}\n]`);
				return { text: `@${display}, ${url}` };
			} catch {
				return { text: `@${display}, upload failed — ${rows.length} command(s) in #${channel.name}.` };
			}
		}

		if (mode === 'rmcmd' || mode === 'removecmd') {
			const id = args[0];
			if (!id) {
				return { text: `@${display}, Usage: ${msg.prefix}${mode} <id> [channel:name]` };
			}

			const prefix = uuidPrefix(id);
			const removed = prefix ? await triggers.removeByPrefix(channel, prefix) : null;
			if (!removed) {
				return { text: `@${display}, trigger command "${id}" not found in #${channel.name}.` };
			}

			return { text: `@${display}, removed trigger command in #${channel.name}. (ID: ${removed})` };
		}

		const trigger = triggers.parseTrigger(p.trigger, p.exact === true);
		const response = args.join(' ').trim();
		if (!trigger) {
			return {
				text: `@${display}, Usage: ${msg.prefix}addcmd trigger:word|/pattern/ <reply> [exact:true] [cooldown:5] [modonly:true] [whitelist:id1,id2] [text:true] [channel:name]`,
			};
		} else if (!response) {
			return { text: `@${display}, please provide a reply.` };
		}

		try {
			void new RegExp(trigger);
		} catch (e) {
			return { text: `@${display}, invalid regex: ${e.message}` };
		}

		const whitelist = p.whitelist
			? p.whitelist
					.split(',')
					.map((i) => i.trim())
					.filter(Boolean)
			: [];
		const uuid = await triggers.add(channel, trigger, response, {
			Cooldown: p.cooldown !== undefined ? Math.max(0, Math.trunc(p.cooldown) || 5) : 5,
			Mod_Only: p.modonly === true,
			Online_Only: p.online === true,
			Offline_Only: p.offline === true,
			Reply: p.reply === true,
			Whitelist: whitelist.length > 0 ? JSON.stringify(whitelist) : null,
			Global_Cooldown: p.global === true,
		});

		return { text: `@${display}, ✅ trigger command created in #${channel.name}. (ID: ${uuid})` };
	},
};
