const { commands } = require('../clients/modules/commands.js');
const { defineCron } = require('../clients/modules/timers.js');
const { buildCommandsUrl } = require('../misc/command-catalog.js');

/**
 * Postet alle 6 h (4x am Tag) eine Werbe-Nachricht mit Link zur Command-Liste in Channels mit !botpromo on, aus sb-v2
 * (ninou2, 29.09.2026: "we need exposure now"; Wortlaut ninou2, 01.10.2026). Gleicher Mechanismus wie autostatus:
 * naechster Termin pro Channel (Channel_Data botpromoNext), Cron tickt alle 5 Minuten.
 */
const POST_INTERVAL = 6 * 60 * 60 * 1000;

const promoText = (url) =>
	`YOU can use @Alexmoderat bot and it Amazing commands for free W (mod the bot and it will join your channel) , all commands can be found in here : ${url ?? 'link temporarily unavailable'}`;

module.exports = defineCron({
	name: 'bot-promo',
	expression: '30 */5 * * * *',
	description: 'Posts a promo message with a link to the command list every 6h in channels with botpromo on.',
	code: async function botPromo() {
		const platform = bot.Twitch;
		const now = Date.now();
		const due = [];
		for (const channel of bot.Channels.getJoinable()) {
			if ((await bot.Channels.getData(channel, 'botpromo')) !== true) {
				continue;
			}

			const dueAt = await bot.Channels.getData(channel, 'botpromoNext');
			if (typeof dueAt !== 'number') {
				await bot.Channels.setData(channel, 'botpromoNext', now + POST_INTERVAL);
			} else if (now >= dueAt) {
				due.push(channel);
			}
		}

		if (due.length === 0) {
			return;
		}

		const message = promoText(await buildCommandsUrl());
		for (const channel of due) {
			await bot.Channels.send(channel, message).catch((e) => console.warn(`[bot-promo] #${channel.name}`, e));
			await bot.Channels.setData(channel, 'botpromoNext', now + POST_INTERVAL);
		}
	},
});

Object.assign(module.exports, { promoText });
