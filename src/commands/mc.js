const { formatDuration } = require('../misc/humanizeDuration.js');
const { checkRole } = require('../token/roles-tv.js');

/** Seit wann jemand Mod (mc) oder VIP (vc) eines Channels ist, aus sb-v2s modcheck (roles.tv, GQL fuer fehlendes grantedAt) */

/** "mc user channel", "mc channel user" mit #, "mc #channel" - ohne # gilt user channel */
const resolveArgs = (a, b, caller) => {
	const clean = (s) =>
		String(s ?? '')
			.toLowerCase()
			.replace(/^[@#]+/, '')
			.trim();
	if (!b) {
		return { user: caller, channel: clean(a) };
	}
	if (String(a).startsWith('#')) {
		return { user: clean(b), channel: clean(a) };
	}
	return { user: clean(a), channel: clean(b) };
};

const command = {
	name: 'mc',
	aliases: ['vc'],
	cooldown: { user: 3 },
	access: { channel: 2 },
	description: 'Shows since when a user has been mod (mc) or VIP (vc) of a channel.',
	usage: 'mc <user> <channel> | vc <user> <channel>',
	execute: async ({ client, message: msg }) => {
		const [first, second] = msg.args;
		const display = msg.displayName;
		const isVip = msg.invocation === 'vc';
		const label = isVip ? 'VIP' : 'mod';

		const { user, channel } = resolveArgs(first, second, msg.sender.name);
		if (!channel) {
			return `@${display}, Usage: ${msg.invocation} <user> <channel>`;
		}

		const result = await checkRole(channel, user, isVip ? 'vip' : 'mod');
		if (!result) {
			return `@${display}, channel "${channel}" not found.`;
		}

		const { found, entry, list } = result;
		if (!found && list.entries.length === 0) {
			return `@${display}, #${channel} has no ${label}s.`;
		}
		if (!found) {
			return `@${display}, ${user} is not a ${label} in #${channel}.`;
		}
		if (!entry?.grantedAt) {
			return `@${display}, ${entry?.displayName ?? user} is a ${label} of #${channel}. (grant time unknown — not available from any source)`;
		}

		const granted = new Date(entry.grantedAt);
		const dateStr = granted.toLocaleString('en-GB', {
			day: '2-digit',
			month: '2-digit',
			year: 'numeric',
			hour: '2-digit',
			minute: '2-digit',
			hour12: false,
			timeZone: 'UTC',
		});
		return `@${display}, ${entry.displayName ?? user} is a ${label} of #${channel}. ` + `Granted ${formatDuration(Date.now() - granted.getTime())} ago. (${dateStr} UTC)`;
	},
};

module.exports = { command };

Object.assign(module.exports, { resolveArgs });
