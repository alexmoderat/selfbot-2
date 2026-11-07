const { setTimeout: sleep } = require('node:timers/promises');

/**
 * Text mehrfach hintereinander senden, aus sb-v2 (ninou2 sah das bei drapsnatt, 22.09.2026). Zwei Twitch-Bremsen:
 *  - Duplicate-Schutz: Twitch verwirft eine Nachricht, die exakt der letzten gleicht -> jede Wiederholung bekommt
 *    eine wachsende Zahl unsichtbarer Zero-Width-Spaces
 *  - Sende-Rate: Mods 100 Nachrichten/30 s -> 400 ms Pause (alexmoderat, 22.09.2026)
 * Hartes Limit 20 - reines Spam-Tool. Mod statt Owner (alexmoderat, 10.10.2026: "mach mal mod ich will nicht jeden
 * admin geben").
 */
const MAX_COUNT = 20;
const SEND_DELAY = 400;
const ZWS = '\u200B';

module.exports = {
	name: 'repeat',
	aliases: ['rm'],
	cooldown: 3000,
	description: `Sends a text N times in a row (max ${MAX_COUNT}) — spam tool, not a moderation feature.`,
	usage: 'repeat <count> <text...>',
	// Ohne cooldown-notice verschwindet ein zu frueher Retry kommentarlos
	flags: ['mod', 'cooldown-notice'],
	execute: async (client, msg) => {
		const [countRaw, ...words] = msg.args;
		const display = msg.displayName;
		const count = Number(countRaw);
		const text = words.join(' ').trim();
		if (!Number.isInteger(count) || count < 1 || count > MAX_COUNT || !text) {
			return { text: `@${display}, Usage: ${msg.prefix}${msg.invocation} <count 1-${MAX_COUNT}> <text...>` };
		}

		for (let i = 0; i < count; i++) {
			if (i > 0) {
				await sleep(SEND_DELAY);
			}

			await msg.send(`${text} ${ZWS.repeat(i + 1)}`);
		}

		return { text: null };
	},
};
