/** An-/Abmeldung fuer Raid-Event-Pings (Modul raid-notifier), aus sb-v2s raidnotify */
const command = {
	name: 'subraid',
	aliases: ['unsubraid'],
	cooldown: { user: 3 },
	access: { channel: 0 },
	description: 'Subscribe to or unsubscribe from raid notifications.',
	usage: '!subraid | !unsubraid',
	flags: ['no-prefix'],
	execute: async ({ client, message: msg }) => {
		const display = msg.displayName;
		const channel = msg.channelData;
		if (!channel) {
			return `@${display}, this only works in a channel.`;
		}

		if (msg.invocation === 'unsubraid') {
			const result = await bot.DB.RaidSubscriber.deleteOne({ channel: channel.id, userAlias: msg.sender.id });
			return result.deletedCount > 0 ? `@${display}, ✅ You have been unsubscribed from raid notifications.` : `@${display}, You were not subscribed.`;
		}

		await bot.DB.RaidSubscriber.updateOne({ channel: channel.id, userAlias: msg.sender.id }, { $setOnInsert: { added: new Date() } }, { upsert: true });
		return `@${display}, ✅ You will be notified when a raid starts. Type !unsubraid to unsubscribe.`;
	},
};

module.exports = { command };
