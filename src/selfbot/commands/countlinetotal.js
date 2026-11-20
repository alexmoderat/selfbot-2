const SupiDate = require('../util/date.js');

// Supibots commands/countlinetotal: Summe der AUTO_INCREMENT-Werte aller Log-Tabellen, Rate ueber einen Redis-Stand

const cacheKey = 'selfbot-count-line-total-previous';

module.exports = {
	name: 'countlinetotal',
	aliases: ['clt', 'totalcountline'],
	cooldown: 120_000,
	description: 'Fetches the number of chat lines from ALL the log tables the bot uses, and the rate they are being added at.',
	usage: 'countlinetotal',
	flags: ['mention'],
	execute: async (client, msg) => {
		// Supibot nahm AUTO_INCREMENT aller Log-Tabellen; hier die (geschaetzte) Zahl der Dokumente in chatLines
		const chatLineAmount = await bot.DB.ChatLine.estimatedDocumentCount();

		if (!chatLineAmount) {
			return { success: false, text: 'No chat lines are currently being logged!' };
		}

		let historyText = '';
		const history = await bot.Redis.getJSON(cacheKey);
		if (history) {
			const days = (SupiDate.now() - history.timestamp) / 864e5;
			const linesPerHour = bot.Utils.round((Number(chatLineAmount) - history.amount) / (days * 24), 0);
			historyText = ` Lines are being added at a rate of ${bot.Utils.groupDigits(linesPerHour)} lines/hr.`;
		} else {
			await bot.Redis.setJSON(cacheKey, { timestamp: SupiDate.now(), amount: Number(chatLineAmount) }, 365 * 864e5);
		}

		return { text: `Currently logging ${bot.Utils.groupDigits(Number(chatLineAmount))} lines in total across all channels.${historyText}` };
	},
};
