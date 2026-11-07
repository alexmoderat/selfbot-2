const { defineCron } = require('../clients/modules/timers.js');
const { subscribeAll } = require('../services/notifications.js');

/** Abonniert neue notify-live-/titlenotify-Eintraege nach (sb-v2: alle 10 min; doppelte Topics ueberspringt pubsub) */
module.exports = defineCron({
	name: 'notify-resync',
	expression: '0 */10 * * * *',
	description: 'Re-subscribes the PubSub topics of all watched streamers (notify live, titlenotify).',
	code: async function notifyResync() {
		await subscribeAll();
	},
});
