/**
 * Follow-Bot-Schutz an/aus, opt-in je Channel (Modul follow-protection), aus sb-v2. Bannt neue Follower nur,
 * wenn zufaelliger Name UND Standard-Profilbild zusammenkommen (Vorfall kletztenbrot, 15.08.2026), dazu
 * CatQuery-Watchlist und Fake-Live-Erkennung. Einschalten abonniert channel.follow fuer den Channel.
 */
module.exports = {
	name: 'followprotection',
	aliases: ['followprotect'],
	cooldown: 3000,
	description: 'Toggles automatic banning of likely follow-bot accounts (name pattern + default avatar).',
	usage: 'followprotection on | off',
	flags: ['mod'],
	execute: async (client, msg) => {
		const [sub] = msg.args;
		const display = msg.displayName;
		const channel = msg.channelData;
		if (!channel) {
			return { text: `@${display}, this only works in a channel.` };
		}

		const value = sub?.toLowerCase();
		if (value !== 'on' && value !== 'off') {
			const enabled = await bot.Channels.getData(channel, 'followProtection');
			return { text: `@${display}, follow-bot protection is ${enabled ? 'ON' : 'OFF'}. Usage: ${msg.prefix}${msg.invocation} on | off` };
		}

		await bot.Channels.setData(channel, 'followProtection', value === 'on');
		if (value === 'on') {
			const subscribed = await bot.Twitch.subscribeFollows(channel);
			if (!subscribed) {
				return { text: `@${display}, follow-bot protection turned ON, but subscribing to follow events failed — am I a moderator here?` };
			}
		}

		return { text: `@${display}, follow-bot protection turned ${value.toUpperCase()}.` };
	},
};
