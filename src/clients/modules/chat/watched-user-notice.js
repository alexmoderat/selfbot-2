const { defineChatModule } = require('../chat-modules.js');
const { getModLogChannel, sayModLog } = require('../../../util/moderation.js');
const watchAlerts = require('../../../util/watch-alerts.js');
const { createWatchNotifier } = require('../../../util/watch-notice.js');

/**
 * Meldet jede Nachricht eines beobachteten Accounts (globale Liste, !watchalert) im Mod-Log - kein Ban, aus sb-v2.
 * Gedrosselt (siehe utils/watch-notice.ts).
 */
const notifier = createWatchNotifier({ say: sayModLog });

module.exports = defineChatModule({
	name: 'watched-user-notice',
	description: 'Reports messages of watched accounts (watchalert) in the mod log, without banning.',
	scope: 'global',
	initialize: async () => {
		await watchAlerts.init();
	},
	handlers: {
		message: async (context) => {
			const { channel, user, message } = context;
			if (channel.name === getModLogChannel()) {
				return;
			}

			const entry = watchAlerts.find(user.twitchId, user.name);
			if (entry) {
				await notifier.handle(user.name, entry.reason, channel.name, message);
			}
		},
	},
});
