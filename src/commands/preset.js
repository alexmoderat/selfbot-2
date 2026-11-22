const { getPermissions } = require('../clients/modules/handler.js');
const { listOrLink } = require('../util/list-reply.js');
const phrases = require('../util/moderation-phrases.js');

/**
 * Presets sind wiederverwendbare Phrasensammlungen, die man je Channel aktivieren kann (z. B. "sellerbot"), aus sb-v2.
 * Anlegen, Loeschen und Phrasen aendern darf nur der Owner, ansehen und je Channel schalten alle Mods.
 */
const OWNER_ONLY = new Set(['create', 'delete', 'addphrase', 'addregex', 'removephrase', 'autoenable']);

/** "phrase | grund" trennen */
const splitPhraseAndReason = (rest, fallbackReason) => {
	const index = rest.indexOf('|');
	const phrase = (index >= 0 ? rest.slice(0, index) : rest).trim();
	const reason = (index >= 0 ? rest.slice(index + 1) : '').trim() || fallbackReason;
	return { phrase, reason };
};

const command = {
	name: 'preset',
	cooldown: { user: 3 },
	access: { channel: 2 },
	description: 'Manage phrase presets and enable them per channel.',
	usage: 'preset <list|phrases|info|status|enable|disable|create|delete|addphrase|addregex|removephrase|autoenable> …',
	// Loeschen nur nach zweiter Bestaetigung (ninou2, 06.10.2026)
	flags: ['confirm'],
	execute: async ({ client, message: msg }) => {
		const [sub, ...args] = msg.args;
		const display = msg.displayName;
		const action = sub?.toLowerCase();
		const usage = `${msg.prefix}${msg.invocation}`;

		if (OWNER_ONLY.has(action)) {
			const permissions = getPermissions(msg);
			if (!permissions.administrator) {
				return null; // stillschweigend ignorieren, wie in sb-v2
			}
		}

		const presetName = args[0]?.toLowerCase();
		const findChannel = (raw) => {
			const name = (raw ?? msg.channelData?.name ?? '').replace(/^#/, '').toLowerCase();
			return { name, channel: bot.Channels.get(name) };
		};

		switch (action) {
			case 'list': {
				const list = phrases.getPresets();
				if (list.length === 0) {
					return `@${display}, no presets exist.`;
				}

				return `@${display}, presets (${list.length}): ${await listOrLink(
						list.map((i) => `${i.Name} (${phrases.getPresetPhrases(i.ID).length})`),
						'Presets',
					)}`;
			}

			case 'phrases': {
				if (!presetName) {
					return `@${display}, Usage: ${usage} phrases <preset>`;
				}

				const target = phrases.getPreset(presetName);
				const list = target ? phrases.getPresetPhrases(target.ID) : [];
				if (list.length === 0) {
					return `@${display}, no phrases in "${presetName}".`;
				}

				const lines = list.map((i) => `[${i.ID}] ${i.Is_Regex ? '~' : ''}${i.Phrase}`);
				return `@${display}, ${presetName} has ${list.length} phrases: ${await listOrLink(lines, `Preset ${presetName}`)}`;
			}

			case 'info': {
				if (!presetName) {
					return `@${display}, Usage: ${usage} info <preset>`;
				}

				const target = phrases.getPreset(presetName);
				if (!target) {
					return `@${display}, preset "${presetName}" not found.`;
				}

				const channels = phrases
					.getPresetChannelIds(target.ID)
					.map((i) => bot.Channels.get(i)?.Name)
					.filter(Boolean);
				return `@${display}, preset "${target.Name}" · ${phrases.getPresetPhrases(target.ID).length} phrases · channels: ${channels.length > 0 ? `${channels.length} — ${await listOrLink(channels, `Channels with preset ${target.Name}`)}` : 'none'}${target.Description ? ` · ${target.Description}` : ''}`;
			}

			case 'status': {
				const { name, channel } = findChannel(args[0]);
				const enabled = channel ? phrases.getChannelPresets(channel.id).map((i) => i.Name) : [];
				return enabled.length > 0
							? `@${display}, active presets in #${name} (${enabled.length}): ${await listOrLink(enabled, `Active presets in #${name}`)}`
							: `@${display}, no presets active in #${name}.`;
			}

			case 'enable':
			case 'disable': {
				if (!presetName) {
					return `@${display}, Usage: ${usage} ${action} <preset> [channel]`;
				}

				const target = phrases.getPreset(presetName);
				if (!target) {
					return `@${display}, preset "${presetName}" not found.`;
				}

				const { name, channel } = findChannel(args[1]);
				if (!channel) {
					return `@${display}, I'm not in #${name}.`;
				}

				if (action === 'enable') {
					await phrases.enablePreset(target, channel.id, msg.sender.name);
					return `@${display}, preset "${presetName}" enabled in #${channel.name}.`;
				}

				const ok = await phrases.disablePreset(target, channel.id);
				return ok ? `@${display}, preset "${presetName}" disabled in #${channel.name}.` : `@${display}, preset was not active.`;
			}

			case 'create': {
				if (!presetName) {
					return `@${display}, Usage: ${usage} create <name> [description]`;
				} else if (phrases.getPreset(presetName)) {
					return `@${display}, preset "${presetName}" already exists.`;
				}

				await phrases.createPreset(presetName, args.slice(1).join(' ') || null, msg.sender.name);
				return `@${display}, preset "${presetName}" created.`;
			}

			case 'delete': {
				if (!presetName) {
					return `@${display}, Usage: ${usage} delete <preset>`;
				}

				const target = phrases.getPreset(presetName);
				if (!target) {
					return `@${display}, preset not found.`;
				}

				await phrases.deletePreset(target);
				return `@${display}, preset "${presetName}" deleted.`;
			}

			case 'addphrase':
			case 'addregex': {
				if (!presetName) {
					return `@${display}, Usage: ${usage} ${action} <preset> <phrase> [| reason]`;
				}

				const target = phrases.getPreset(presetName);
				if (!target) {
					return `@${display}, preset "${presetName}" not found.`;
				}

				const { phrase, reason } = splitPhraseAndReason(args.slice(1).join(' '), presetName);
				if (!phrase) {
					return `@${display}, phrase must not be empty.`;
				}

				if (action === 'addregex') {
					try {
						new RegExp(phrase, 'i');
					} catch (e) {
						return `@${display}, invalid regex: ${e.message}`;
					}
				}

				await phrases.addPhrase({ preset: target.ID }, { phrase, reason, isRegex: action === 'addregex', regexFlags: 'i', addedBy: msg.sender.name });
				return `@${display}, ${action === 'addregex' ? 'regex' : 'phrase'} "${phrase}" added to preset "${presetName}".`;
			}

			case 'removephrase': {
				const id = Number(args[1]);
				if (!presetName || !Number.isInteger(id)) {
					return `@${display}, Usage: ${usage} removephrase <preset> <id>`;
				}

				const target = phrases.getPreset(presetName);
				const found = target ? phrases.getPresetPhrases(target.ID).find((i) => i.ID === id) : undefined;
				if (!found) {
					return `@${display}, phrase not found.`;
				}

				await phrases.removePhrase(found);
				return `@${display}, phrase ${id} removed from "${presetName}".`;
			}

			case 'autoenable': {
				const value = args[1]?.toLowerCase();
				if (!presetName || (value !== 'on' && value !== 'off')) {
					return `@${display}, Usage: ${usage} autoenable <preset> <on|off>`;
				}

				const target = phrases.getPreset(presetName);
				if (!target) {
					return `@${display}, preset not found.`;
				}

				await phrases.setPresetAutoEnable(target, value === 'on');
				return `@${display}, auto-enable for "${presetName}" ${value === 'on' ? 'enabled' : 'disabled'}.`;
			}

			default:
				return `@${display}, Usage: ${usage} <list|phrases|info|status|enable|disable|…>`;
		}
	},
};

module.exports = { command };
