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
			const result = await core.Query.raw(`DELETE FROM selfbot_data.Raid_Subscriber WHERE Channel = ${channel.id} AND User_Alias = ${msg.sender.id}`); // TODO(port)
			return {
				text: result.affectedRows > 0 ? `@${display}, ✅ You have been unsubscribed from raid notifications.` : `@${display}, You were not subscribed.`,
			};
		}

		await core.Query.raw(`INSERT IGNORE INTO selfbot_data.Raid_Subscriber (Channel, User_Alias) VALUES (${channel.id}, ${msg.sender.id})`); // TODO(port)
		return { text: `@${display}, ✅ You will be notified when a raid starts. Type !unsubraid to unsubscribe.` };
	},
};
