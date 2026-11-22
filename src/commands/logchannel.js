const { listOrLink } = require('../util/list-reply.js');
const { addExtra, callAdmin, currentChannels, getExtras, readAdminKey, removeExtra, resolveIds } = require('../token/justlog.js');

/**
 * Channels im oeffentlichen Chat-Logger (justlog) verwalten, aus sb-v2. Die Bot-Channels pflegt der Cron justlog-sync;
 * dieser Command ist fuer Channels ohne den Bot - sie landen in einer Zusatzliste, damit der Abgleich sie nicht
 * wieder entfernt. Hinzufuegen/Entfernen wirkt sofort ueber justlogs Admin-API.
 */
const command = {
	name: 'logchannel',
	aliases: ['logs', 'addlog'],
	cooldown: { user: 3 },
	access: { global: 1 },
	description: 'Manages the channels of the public chat logger.',
	usage: 'logchannel add <channel> | remove <channel> | list',
	// Entfernen nur nach zweiter Bestaetigung (ninou2, 06.10.2026)
	flags: ['confirm'],
	execute: async ({ client, message: msg }) => {
		const args = [...msg.args];
		const display = msg.displayName;
		const sub = String(args[0] ?? '').toLowerCase();
		const channel = String(args[1] ?? '')
			.toLowerCase()
			.replace(/^[@#]+/, '')
			.trim();

		const key = readAdminKey();
		if (!key) {
			return `@${display}, no admin key for justlog found.`;
		}

		if (sub === 'list' || !sub) {
			const [tracked, extras] = await Promise.all([currentChannels().catch(() => []), getExtras().catch(() => [])]);
			const shown = extras.length > 0 ? `: ${await listOrLink(extras, 'Logger channels added by hand')}` : '';
			return `@${display}, the logger tracks ${tracked.length} channels, ${extras.length} of them added by hand${shown}.`;
		} else if (!channel) {
			return `@${display}, Usage: ${msg.prefix}${msg.invocation} ${sub} <channel>`;
		}

		if (sub === 'add') {
			const [id] = await resolveIds([channel]);
			if (!id) {
				return `@${display}, channel "${channel}" does not exist.`;
			}

			const tracked = await currentChannels().catch(() => []);
			if (tracked.some((i) => i.name === channel)) {
				// Trotzdem in die Zusatzliste, sonst faellt er beim naechsten Abgleich raus, falls der Bot geht
				await addExtra(channel);
				return `@${display}, ${channel} is already being logged — now also added permanently.`;
			}

			await callAdmin('POST', [id], key);
			await addExtra(channel);
			return `@${display}, ✅ ${channel} is now being logged.`;
		} else if (sub === 'remove' || sub === 'del') {
			const tracked = await currentChannels().catch(() => []);
			const match = tracked.find((i) => i.name === channel);
			const wasExtra = await removeExtra(channel);
			if (!match) {
				return wasExtra ? `@${display}, ${channel} removed from the list (the logger was not tracking it anyway).` : `@${display}, ${channel} is not being logged.`;
			}

			await callAdmin('DELETE', [match.userID], key);
			return `@${display}, ${channel} is no longer being logged.${wasExtra ? '' : ' Note: the bot is in that channel, the next sync will add it again.'}`;
		}

		return `@${display}, Usage: ${msg.prefix}${msg.invocation} add|remove <channel> | list`;
	},
};

module.exports = { command };
