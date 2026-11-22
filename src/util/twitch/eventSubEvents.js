// EventSub-Ereignisse -> Chat-Module, wie DontAddThisBots eventSubEvents.js (ein Handler je Abo-Typ)

module.exports = {
	'channel.follow': (event) => {
		const channel = bot.Channels.getByTwitchId(String(event.broadcaster_user_id));
		if (!channel) {
			return;
		}

		// Gleiche Felder wie im alten selfbot (follow-announce, follow-protection)
		bot.ChatModules.dispatch('follow', {
			channel,
			userId: String(event.user_id),
			userName: String(event.user_login).toLowerCase(),
			userDisplayName: event.user_name,
			followedAt: event.followed_at,
		});
	},
};
