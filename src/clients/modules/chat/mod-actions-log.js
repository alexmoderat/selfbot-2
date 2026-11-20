const { defineChatModule } = require('../chat-modules.js');
const { recordModAction, wasRecentlyRecorded } = require('../../../util/moderation.js');

/**
 * Protokolliert Moderationsaktionen aus chat_moderator_actions (Hermes) und schreibt Bans/Timeouts/Warns
 * in den Ban-Log (aus sb-v2). Pro Aktion: wie formatieren und ob protokollieren.
 */

const ACTIONS = {
	ban: { record: 'ban', status: 'REGULAR', text: (a) => (a[1] ? `(${a[1]})` : '') },
	timeout: { record: 'timeout', status: 'TIMEOUT', text: (a) => `(${a[1] ?? '?'}s${a[2] ? `: ${a[2]}` : ''})` },
	warn: { record: 'warn', status: 'WARN', text: (a) => (a[1] ? `(${a[1]})` : '') },
	unban: { text: () => '' },
	untimeout: { text: () => '' },
	delete: { text: (a) => (a[1] ? `— "${a[1]}"` : '') },
	mod: { text: () => '' },
	unmod: { text: () => '' },
	vip: { text: () => '' },
	unvip: { text: () => '' },
	raid: { text: (a) => `→ ${a[0] ?? '?'}` },
	unraid: { text: () => '' },
	clear: { text: () => '' },
	emoteonly: { text: () => '' },
	emoteonlyoff: { text: () => '' },
	subscribers: { text: () => '' },
	subscribersoff: { text: () => '' },
	slow: { text: (a) => `(${a[0] ?? '?'}s)` },
	slowoff: { text: () => '' },
};

module.exports = defineChatModule({
	name: 'mod-actions-log',
	description: 'Logs moderation actions and records bans, timeouts and warnings in the ban log.',
	scope: 'global',
	handlers: {
		modAction: (context) => {
			const data = context.payload?.data;
			const action = data?.moderation_action;
			if (!action) {
				return;
			}

			const channelName = context.channel?.name ?? context.broadcasterId;
			const args = data.args ?? [];
			const targetUser = String(args[0] || data.target_user_login || '?');
			const modName = data.created_by || '?';
			const spec = ACTIONS[action];
			if (!spec) {
				console.log(`[pubsub] ${action} in ${channelName} by ${modName}`);
				return;
			}

			const detail = spec.text(args);
			console.log(`[pubsub] ${action}: ${targetUser} in ${channelName} by ${modName}${detail ? ` ${detail}` : ''}`);

			// Nur echte Sanktionen - und nicht doppelt, wenn der Bot sie selbst ausgeloest hat (steht dann schon im Log)
			if (!spec.record || wasRecentlyRecorded(targetUser, channelName)) {
				return;
			}

			const reason = action === 'timeout' ? `${args[1] ?? '?'}s${args[2] ? `: ${args[2]}` : ''}` : String(args[1] || '');

			recordModAction({
				type: spec.record,
				username: targetUser,
				userId: data.target_user_id || null,
				channelName,
				channel: context.channel,
				reason,
				status: spec.status ?? '',
				duration: action === 'timeout' ? Number(args[1]) || null : null,
				modName,
			});
		},
	},
});
