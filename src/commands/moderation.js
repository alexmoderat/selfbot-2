const { answerNthBotBan, formatBotbansText, getAutobanCounts } = require('../util/moderation.js');

/**
 * Auto-Ban-Zahlen eines Channels plus zwei Schalter (aus sb-v2):
 *   moderation / autobans / botbans   Zahlen ausgeben
 *   botbanstext <text|reset>          Vorlage fuer die Ausgabe ({username} {channel} {count} {global})
 *   banannounce on|off                automatische Meldung nach jedem Auto-Ban
 * sb-v2 schickte die Zahlen als /me - ueber Helix gibt es kein /me, daher als normale Nachricht.
 */
const DEFAULT_TEMPLATE = '@{username} Auto-Bans in #{channel}: {count} · Global: {global}.';

module.exports = {
	name: 'moderation',
	// bb: ninou2, 28.10.2026 ("the !botbans should be also !bb")
	aliases: ['autobans', 'botbans', 'bb', 'botbanstext', 'banannounce'],
	cooldown: 3000,
	description: 'Channel auto-ban counts; set the message template and the automatic announcement.',
	usage: 'moderation | botbans [number] | botbans global [number] | botbanstext <text|reset> | banannounce <on|off>',
	// !autobans und !botbans liefen schon immer ohne Prefix
	flags: ['mod', 'no-prefix', 'confirm'],
	execute: async (client, msg) => {
		const args = [...msg.args];
		const display = msg.displayName;
		const channel = msg.channelData;
		if (!channel) {
			return { text: `@${display}, this only works in a channel.` };
		}

		if (msg.invocation === 'botbanstext') {
			const text = args.join(' ').trim();
			if (!text) {
				const current = await bot.Channels.getData(channel, 'botbansText');
				return { text: `@${display}, Current template: ${current || DEFAULT_TEMPLATE}` };
			} else if (text === 'reset') {
				await bot.Channels.setData(channel, 'botbansText', null);
				return { text: `@${display}, botbans text reset.` };
			}

			await bot.Channels.setData(channel, 'botbansText', text);
			return { text: `@${display}, botbans text updated.` };
		}

		if (msg.invocation === 'banannounce') {
			const state = args[0]?.toLowerCase();
			if (state !== 'on' && state !== 'off') {
				const current = await bot.Channels.getData(channel, 'autobanAnnounce');
				return {
					text: `@${display}, Auto-ban announcements in #${channel.name}: ${current ? 'on' : 'off'}. Usage: ${msg.prefix}${msg.invocation} <on|off>`,
				};
			}

			await bot.Channels.setData(channel, 'autobanAnnounce', state === 'on');
			return { text: `@${display}, Auto-ban announcements in #${channel.name} ${state === 'on' ? 'enabled' : 'disabled'}.` };
		}

		// "!bb 5" / "!bb global 366": Abkuerzung fuer !whenbotbans (alexmoderat, 28.10.2026: beide Aliase)
		const nth = await answerNthBotBan(args, channel.name, display);
		if (nth) {
			return { text: nth };
		}

		const counts = await getAutobanCounts(channel.name);
		const template = await bot.Channels.getData(channel, 'botbansText');
		return {
			text: formatBotbansText(template, { username: msg.sender.name, channel: channel.name, count: counts.channel, global: counts.global }),
		};
	},
};
