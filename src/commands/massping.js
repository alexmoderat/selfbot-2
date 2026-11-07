const { setTimeout: sleep } = require('node:timers/promises');
const { listOrLink } = require('../misc/list-reply.js');
const { Filter } = require('../services/filter.js');
const { fetchChatters } = require('../misc/twitch-lists.js');

/**
 * Pingt alle aktuell im Chat Anwesenden, optional mit Ankuendigung, aus sb-v2 (alexmoderat, 22.09.2026). Bewusst nur
 * die eigene Chatterliste (keine frei eingebbaren Namen) und hoechstens 100 Pings; braucht Mod-Rechte des Bots.
 * Sperrliste fuer missbrauchende Mods ("Kannst ja ne Funktion adden das ich user blacklisten kann"): sb-v2 fuehrte eine
 * eigene Tabelle, hier ist es Supibots Filter - eine globale Blacklist fuer User + massping (wie "ban user:x
 * command:massping channel:global"). block/unblock/blocklist nur fuer Bot-Administratoren.
 */
const MAX_PINGS = 100;
const PINGS_PER_MESSAGE = 15;
const SEND_DELAY = 400;
const COMMAND_NAME = 'massping';

const findBlock = (userId) =>
	Filter.getLocals('Blacklist', { command: COMMAND_NAME, includeInactive: true, skipUserCheck: true }).find(
		(i) => i.User_Alias === userId && i.Channel === null && i.Platform === null && i.Invocation === null,
	) ?? null;

/** Wer per "optout massping" (oder "optout all") raus ist, wird nicht mitgepingt (ItsBr0dyy, 04.11.2026: "how do i opt out") */
const withoutOptedOut = async (names, options) => {
	const filters = Filter.getLocals('Opt-out', { ...options, command: COMMAND_NAME, skipUserCheck: true });
	const users = await Promise.all(filters.map((i) => bot.Users.get(i.User_Alias)));
	const optedOut = new Set(users.map((i) => i?.Name.toLowerCase()));
	return names.filter((i) => !optedOut.has(i.toLowerCase()));
};

module.exports = {
	name: 'massping',
	aliases: ['pingall'],
	cooldown: 3000,
	description: `Pings everyone currently in chat (max ${MAX_PINGS}), optionally with an announcement text. Owner: "massping block/unblock/blocklist <user>" locks a mod out globally.`,
	usage: 'massping [announcement text] | massping block <user> [reason] | massping unblock <user> | massping blocklist',
	flags: ['mod', 'cooldown-notice', 'opt-out'],
	execute: async (client, msg) => {
		const [first, ...words] = msg.args;
		const display = msg.displayName;
		const sub = first?.toLowerCase();

		if (sub === 'block' || sub === 'unblock' || sub === 'blocklist') {
			if ((await bot.Users.getData(msg.sender, 'administrator')) !== true) {
				return { text: `@${display}, bot owner only.` };
			}

			if (sub === 'blocklist') {
				const blocked = Filter.getLocals('Blacklist', { command: COMMAND_NAME, skipUserCheck: true }).filter(
					(i) => i.User_Alias !== null && i.Channel === null,
				);
				const names = await Promise.all(blocked.map(async (i) => (await bot.Users.get(i.User_Alias))?.Name ?? `#${i.User_Alias}`));
				return {
					text:
						names.length > 0
							? `@${display}, blocked from ${COMMAND_NAME} (${names.length}): ${await listOrLink(names, `Blocked from ${COMMAND_NAME}`)}`
							: `@${display}, no one is blocked from ${COMMAND_NAME}.`,
				};
			}

			const target = words[0]
				?.toLowerCase()
				.replace(/^[@#]+/, '')
				.trim();
			if (!target) {
				return { text: `@${display}, Usage: ${msg.prefix}${msg.invocation} ${sub} <user>${sub === 'block' ? ' [reason]' : ''}` };
			}

			const user = await bot.Users.get(target);
			const existing = user ? findBlock(user.id) : null;
			if (sub === 'unblock') {
				if (!existing?.Active) {
					return { text: `@${display}, ${target} wasn't blocked.` };
				}

				await existing.toggle();
				return { text: `@${display}, ${target} can use ${COMMAND_NAME} again.` };
			}

			if (!user) {
				return { text: `@${display}, user ${target} not found.` };
			} else if (existing) {
				if (!existing.Active) {
					await existing.toggle();
				}
			} else {
				const reason = words.slice(1).join(' ').trim();
				await Filter.create({
					User_Alias: user.id,
					Command: COMMAND_NAME,
					Type: 'Blacklist',
					Response: 'Reason',
					Reason: `You've been blocked from using ${COMMAND_NAME}.${reason ? ` (${reason})` : ''}`,
					Issued_By: msg.sender.id,
				});
			}

			return { text: `@${display}, ${target} can no longer use ${COMMAND_NAME} (any channel).` };
		}

		const channel = msg.channelData;
		if (!channel?.twitchId) {
			return { text: `@${display}, this only works in a channel.` };
		}

		const result = await fetchChatters(channel.twitchId, bot.Twitch.selfId);
		if (result.forbidden) {
			return { text: `@${display}, no mod rights in #${channel.name} — Twitch only gives out the chatter list to moderators.` };
		}

		const names = await withoutOptedOut(
			result.names.filter((i) => i.toLowerCase() !== bot.Twitch.selfName),
			{ channel, platform: bot.Twitch, invocation: msg.invocation },
		);
		if (names.length === 0) {
			return { text: `@${display}, no one else is in chat right now.` };
		}

		const pinged = names.slice(0, MAX_PINGS);
		const chunks = [];
		for (let i = 0; i < pinged.length; i += PINGS_PER_MESSAGE) {
			chunks.push(
				pinged
					.slice(i, i + PINGS_PER_MESSAGE)
					.map((j) => `@${j}`)
					.join(' '),
			);
		}

		const announcement = [first, ...words].filter(Boolean).join(' ').trim();
		if (announcement) {
			chunks[0] = `${announcement} ${chunks[0]}`;
		}

		for (let i = 0; i < chunks.length; i++) {
			if (i > 0) {
				await sleep(SEND_DELAY);
			}

			await msg.send(chunks[i]);
		}

		console.log(
			`[massping] #${channel.name} von ${msg.sender.name}: ${pinged.length} gepingt${names.length > MAX_PINGS ? ` (gedeckelt, ${names.length} da)` : ''}`,
		);
		return { text: null };
	},
};

Object.assign(module.exports, { withoutOptedOut });
