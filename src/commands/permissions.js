const { getCommand } = require('../clients/modules/commands.js');
const { getPermissions } = require('../clients/modules/handler.js');
const { uploadList } = require('../token/haste.js');
const { applyLevel, describeLevel, effectiveLevel, parseLevel } = require('../clients/modules/levels.js');

/**
 * Rechte-Stufe je Command im eigenen Channel (ninou2, 29.10.2026: "so for all the commands you dont have the permissions
 * levels yet"): "perm <command> everyone|mods|streamer". Nur strenger als der Command ohnehin ist; aendern darf nur
 * der Streamer (und Bot-Admins), ansehen jeder. Dieselbe Einstellung wie im Dashboard unter Bot Commands.
 */
const MAX_INLINE = 350;

module.exports = {
	name: 'permissions',
	aliases: ['perm', 'perms'],
	cooldown: 3000,
	description: 'Shows or sets who can use a command in this channel: everyone, mods or streamer only (only stricter than the command itself).',
	usage: 'perm | perm <command> | perm <command> everyone|mods|streamer',
	execute: async (client, msg) => {
		const [commandName, levelInput] = msg.args;
		const display = msg.displayName;
		const channel = msg.channelData;
		if (!channel) {
			return { success: false, text: 'This command cannot be used in PMs!' };
		}

		const prefix = msg.prefix;
		const overrides = (await bot.Channels.getData(channel, 'commandLevels')) ?? {};
		if (!commandName) {
			const entries = Object.entries(overrides).sort(([a], [b]) => a.localeCompare(b));
			if (entries.length === 0) {
				return { text: `@${display}, no command has a stricter level in this channel. Usage: ${prefix}perm <command> everyone|mods|streamer` };
			}

			const group = (level) => entries.filter(([, l]) => l === level).map(([name]) => name);
			const parts = [
				['mods', group('mod')],
				['streamer only', group('streamer')],
			]
				.filter(([, names]) => names.length > 0)
				.map(([label, names]) => `${label}: ${names.join(', ')}`);
			const text = parts.join(' · ');
			if (text.length <= MAX_INLINE) {
				return { text: `@${display}, stricter levels in this channel - ${text}` };
			}

			const link = await uploadList(
				`Command levels in #${channel.name}`,
				entries.map(([name, level]) => `${name}: ${describeLevel(level)}`),
			);
			return { text: `@${display}, ${entries.length} commands have a stricter level in this channel: ${link}` };
		}

		const command = getCommand(commandName.replace(/^!/, '').toLowerCase());
		if (!command) {
			return { success: false, text: `@${display}, there's no command called ${commandName}.` };
		} else if (command.Flags.includes('owner')) {
			return { success: false, text: `@${display}, ${command.Name} is a bot-owner command, its level can't be changed.` };
		}

		const own = command.Flags.includes('mod') ? 'mod' : 'everyone';
		if (!levelInput) {
			return { text: `@${display}, ${command.Name} can be used by: ${describeLevel(effectiveLevel(own, overrides[command.Name]))}.` };
		}

		const level = parseLevel(levelInput);
		if (!level) {
			return { success: false, text: `@${display}, Usage: ${prefix}perm <command> everyone|mods|streamer` };
		}

		const userPermissions = getPermissions(msg);
		if (!userPermissions.channelOwner && !userPermissions.administrator) {
			return { success: false, text: `@${display}, only the streamer can change command levels.` };
		}

		const updated = applyLevel(overrides, command.Name, own, level);
		if (!updated) {
			return { success: false, text: `@${display}, ${command.Name} is mod-only by itself, it can't be opened to everyone.` };
		}

		await bot.Channels.setData(channel, 'commandLevels', updated);
		return { text: `@${display}, ${command.Name} can now be used by: ${describeLevel(effectiveLevel(own, updated[command.Name]))}.` };
	},
};
