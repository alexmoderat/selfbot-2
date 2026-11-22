/** An-/Abmeldung fuer Raid-Event-Pings (Modul raid-notifier), aus sb-v2s raidnotify */
module.exports = {
	name: 'subraid',
	aliases: ['unsubraid'],
	cooldown: 3000,
	description: 'Subscribe to or unsubscribe from raid notifications.',
	usage: '!subraid | !unsubraid',
	flags: ['no-prefix'],
	execute: async (client, msg) => {
		const display = msg.displayName;
		const channel = msg.channelData;
		if (!channel) {
			return { text: `@${display}, this only works in a channel.` };
		}

		if (msg.invocation === 'unsubraid') {
			const result = await bot.DB.RaidSubscriber.deleteOne({ channel: channel.id, userAlias: msg.sender.id });
			return {
				text: result.deletedCount > 0 ? `@${display}, ✅ You have been unsubscribed from raid notifications.` : `@${display}, You were not subscribed.`,
			};
		}

		await bot.DB.RaidSubscriber.updateOne({ channel: channel.id, userAlias: msg.sender.id }, { $setOnInsert: { added: new Date() } }, { upsert: true });
		return { text: `@${display}, ✅ You will be notified when a raid starts. Type !unsubraid to unsubscribe.` };
	},
};
