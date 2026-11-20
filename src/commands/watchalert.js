const { listOrLink } = require('../misc/list-reply.js');
const { fetchTwitchUser } = require('../util/twitch/twitch-utils.js');
const watchAlerts = require('../util/watch-alerts.js');

/**
 * Globale Beobachtungsliste, aus sb-v2: jede Nachricht des Accounts in einem der Bot-Channels wird im Mod-Log
 * gemeldet (Modul watched-user-notice), kein Ban. Zuordnung ueber die User-ID, damit eine Umbenennung nichts aendert.
 */
module.exports = {
	name: 'watchalert',
	aliases: ['wa'],
	cooldown: 3000,
	description: "Global watch list: every message of a listed account in any of the bot's channels is reported in the mod log (no ban).",
	usage: 'watchalert add <user> [reason] | remove <user> | list',
	flags: ['owner'],
	execute: async (client, msg) => {
		const [sub, target, ...rest] = msg.args;
		const display = msg.displayName;
		const action = sub?.toLowerCase();

		if (action === 'list') {
			const entries = await watchAlerts.list();
			if (entries.length === 0) {
				return { text: `@${display}, the watch list is empty.` };
			}

			const names = entries.map((i) => i.login + (i.reason ? ` (${i.reason.slice(0, 30)})` : ''));
			return { text: `@${display}, watching ${entries.length}: ${await listOrLink(names, 'Watch alerts')}` };
		} else if (action !== 'add' && action !== 'remove') {
			return { text: `@${display}, Usage: ${msg.prefix}${msg.invocation} add <user> [reason] | remove <user> | list` };
		}

		const login = target
			?.replace(/^[@#]+/, '')
			.toLowerCase()
			.trim();
		if (!login) {
			return { text: `@${display}, Usage: ${msg.prefix}${msg.invocation} ${action} <user>` };
		}

		if (action === 'remove') {
			const removed = await watchAlerts.remove(login);
			return { text: `@${display}, ${removed ? `${login} removed from the watch list.` : `${login} was not on the watch list.`}` };
		}

		const id = (await fetchTwitchUser(login).catch(() => null))?.id ?? null;
		const reason = rest.join(' ').trim() || null;
		await watchAlerts.add(login, id, reason, msg.sender.name);
		return { text: `@${display}, watching ${login}${id ? ` (${id})` : ' (ID not found — matching by name only)'}${reason ? `: ${reason}` : ''}.` };
	},
};
