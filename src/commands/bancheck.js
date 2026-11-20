const phrases = require('../util/moderation-phrases.js');
const { deobfuscate } = require('../util/text-analysis.js');

/**
 * Wuerde die Nachricht dort per Banphrase getroffen? (aus sb-v2, Antworten von Supibots bancheck uebernommen).
 * Bewusst nur Mods+: die Antwort verraet, dass eine Phrase existiert. Die Phrase selbst wird nie genannt.
 */
module.exports = {
	name: 'bancheck',
	cooldown: 3000,
	description: 'Checks if a message would be banphrased in a channel the bot is in. Result is not 100% guaranteed.',
	usage: 'bancheck <channel> <message>',
	flags: ['mod'],
	execute: async (client, msg) => {
		const [channelRaw, ...rest] = msg.args;
		const display = msg.displayName;
		if (rest.length === 0) {
			return { text: `@${display}, no message provided!` };
		}

		const name = (channelRaw ?? '').replace(/^[#@]/, '').toLowerCase();
		const channel = bot.Channels.get(name);
		const text = deobfuscate(rest.join(' ').toLowerCase());
		const hit = channel ? phrases.findMatch(channel.id, text) : phrases.getGlobal().find((i) => phrases.matches(text, i));

		return {
			text: `@${display}, ${hit ? 'that message is most likely going to get timed out, based on my banphrases.' : 'that message should be fine.'}`,
		};
	},
};
