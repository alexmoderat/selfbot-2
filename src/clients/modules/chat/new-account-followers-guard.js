const { defineChatModule } = require('../chat-modules.js');
const { autoBan, targetFromChannel } = require('../../../util/moderation.js');
const { formatAutoBanReason } = require('../../../misc/ban-reason.js');
const { accountAgeDays, fetchFollowerCount } = require('../../../misc/twitch-lists.js');

/**
 * Bannt frische Accounts mit auffaellig vielen Followern beim Betreten des Chats, aus sb-v2 (alexmoderat, 22.09.2026:
 * nightmaregirlyy, Account von vorgestern, 170 Follower, keine Rolle irgendwo). Das Missverhaeltnis Alter/Follower
 * entsteht organisch kaum in wenigen Tagen - typisch fuer gekaufte Follower vor Scam-/Viewbot-Werbung.
 * Ausdruecklich beim JOIN ("ich wollte eigentlich gleich nachm join"), trifft also auch reine Zuschauer.
 * Nur wo eingeschaltet (Channel_Data newAccountFollowersGuard); Joins kommen vom Join-Poller.
 */
const MIN_AGE_DAYS = 3;
const MIN_FOLLOWERS = 100;

// login#channel - keine Doppel-Banversuche bei mehrfachem Join
const checked = new Set();

module.exports = defineChatModule({
	name: 'new-account-followers-guard',
	description: 'Bans fresh accounts with suspiciously many followers on chat join - only where enabled.',
	scope: 'global',
	handlers: {
		userJoin: async (context) => {
			const { channel, userName, platform } = context;
			if (userName === platform.selfName.toLowerCase() || userName === channel.name || channel.mode !== 'Moderator') {
				return;
			}

			const key = `${userName}#${channel.name}`;
			if (checked.has(key)) {
				return;
			}
			checked.add(key);
			if (checked.size > 20_000) {
				checked.clear();
			}

			if ((await bot.Channels.getData(channel, 'newAccountFollowersGuard')) !== true) {
				return;
			}

			// Die teurere Follower-Abfrage erst nach dem Alterscheck, nur fuer wirklich frische Accounts
			const info = await accountAgeDays(userName);
			if (!info || info.ageDays >= MIN_AGE_DAYS) {
				return;
			}

			const followers = await fetchFollowerCount(info.id);
			if (followers === null || followers <= MIN_FOLLOWERS) {
				return;
			}

			const label = `Account younger than ${MIN_AGE_DAYS} days with ${followers} followers`;
			console.warn(`[new-account-followers-guard] ${userName} in #${channel.name}: ${info.ageDays.toFixed(1)} d, ${followers} Follower`);
			await autoBan(targetFromChannel(channel, info.id, userName), {
				reason: formatAutoBanReason(label, platform.selfName),
				publicReason: label,
				status: 'AUTOMOD_NEWACCOUNT_FOLLOWERS_JOIN',
				automated: true,
			});
		},
	},
});
