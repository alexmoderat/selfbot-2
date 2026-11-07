const { transliterate } = require('transliteration');
const { getConfig } = require('../config.js');
const { asciiArtRegex, emojiRegex, linkRegex, whitespaceRegex, TWITCH_ANTIPING_CHARACTER } = require('../misc/regex.js');
const { Logger } = require('../misc/logger.js');

// Supibots Ausgabe-Filter (bisher classes/banphrase.ts) fuer alles, was der BOT sendet - nicht die
// Moderations-Banphrases gegen Chatter. Regeln stehen als JS-Funktion in banphrases.code.

const inactiveSymbol = Symbol('banphrase-inactive');
const banphrases = new Map();

const getBanphraseConfigData = () => ({
	TWITCH_ANTIPING_CHARACTER,
	massPingBanphraseThreshold: getConfig().values.massPingBanphraseThreshold,
	transliterate: (input) => transliterate(input),
	asciiArtRegex,
	emojiRegex,
	linkRegex,
	whitespaceRegex,
	Date,
});

const fromDoc = (doc) => {
	// new Function hat keinen Zugriff auf den lokalen Scope; der Code kommt nur aus der DB
	const code = new Function(`return (${doc.code});`)();
	if (typeof code !== 'function') {
		throw new Error(`Invalid function definition passed to Banphrase ${doc._id}`);
	}
	return { id: doc._id, type: doc.type, channelId: doc.channelId ?? null, priority: doc.priority ?? 0, code, active: true };
};

const load = async () => {
	banphrases.clear();
	const docs = await bot.DB.Banphrase.find({ type: { $ne: 'Inactive' } })
		.sort({ priority: -1 })
		.lean();
	for (const doc of docs) {
		try {
			banphrases.set(doc._id, fromDoc(doc));
		} catch (e) {
			Logger.warn('[banphrase] konnte nicht geladen werden', { id: doc._id, e: e.message });
		}
	}
	return banphrases.size;
};

const run = async (banphrase, message) => {
	if (!banphrase.active) {
		return inactiveSymbol;
	}
	try {
		return await banphrase.code(message, getBanphraseConfigData());
	} catch (e) {
		Logger.warn('[banphrase] fehlgeschlagen', { message, id: banphrase.id, e: e.message });
		return message;
	}
};

/** @returns {Promise<{ passed: boolean, string: string|null }>} */
const execute = async (message, channel) => {
	let resultMessage = message;
	const channelId = channel?.id ?? null;

	for (const banphrase of banphrases.values()) {
		if (!banphrase.active || banphrase.type === 'API response') {
			continue;
		} else if (banphrase.channelId !== null && banphrase.channelId !== channelId) {
			continue;
		}

		const result = await run(banphrase, resultMessage);
		if (result === inactiveSymbol || result === undefined) {
			continue;
		}
		// Ignorieren oder eigene Antwort: sofort zurueck; Replacement ersetzt weiter
		if (banphrase.type !== 'Replacement') {
			return { string: result || null, passed: false };
		} else if (typeof result !== 'string') {
			throw new Error(`Non-string result of a Replacement Banphrase (${banphrase.id})`);
		}
		resultMessage = result;
	}

	return { string: resultMessage, passed: true };
};

module.exports = { load, execute, _banphrases: banphrases };
