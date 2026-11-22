const { defineChatModule } = require('../chat-modules.js');
const { announceStreamState, announceTitleChange, recordGameChange } = require('../../../util/notifications.js');

/**
 * Loest die notify-live- und titlenotify-Ansagen aus (sb-v2: Teil von stream-status). PubSub-Topics der beobachteten
 * Streamer kommen auch ohne gejointen Channel an (context.channel ist dann null), entscheidend ist broadcasterId.
 */

module.exports = defineChatModule({
	name: 'notifications',
	description: 'Posts notify-live announcements and title-change pings for watched streamers.',
	scope: 'global',
	handlers: {
		videoPlayback: async (context) => {
			const type = context.payload?.type;
			if (type === 'stream-up' || type === 'stream-down') {
				await announceStreamState(context.broadcasterId, type === 'stream-up');
			}
		},
		broadcastSettings: async (context) => {
			const payload = context.payload;
			if (!payload) {
				return;
			}

			if (payload.old_game !== payload.game) {
				await recordGameChange(context.broadcasterId, payload.game ?? null).catch(() => {});
			}
			// Titel-Alarm nur beim Titel, nicht bei reinem Kategoriewechsel
			if (payload.old_status !== payload.status && payload.status) {
				await announceTitleChange(context.broadcasterId, payload.status, payload.game);
			}
		},
	},
});
