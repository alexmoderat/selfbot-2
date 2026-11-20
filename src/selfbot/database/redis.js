const Redis = require('ioredis');
const { Logger } = require('../misc/logger.js');

// Redis wie bei DontAddThisBot (bot.Redis), dazu JSON-Helfer statt supi-core Cache.
// Eigene DB-Nummer aus config.json, damit sich Schluessel nicht mit selfbot/sb-v2 ueberschneiden.

const PREFIX = 'selfbot-next:';

const create = ({ host, port, db }) => {
	const client = new Redis({ host, port, db, lazyConnect: false, maxRetriesPerRequest: 3 });
	client.on('error', (e) => Logger.warn('[redis]', e.message));

	/** Wert lesen (JSON), null wenn nicht vorhanden */
	client.getJSON = async (key) => {
		const raw = await client.get(PREFIX + key);
		if (raw === null) {
			return null;
		}
		try {
			return JSON.parse(raw);
		} catch {
			return null;
		}
	};

	/** Wert schreiben (JSON); expiry in ms, null loescht den Schluessel */
	client.setJSON = async (key, value, expiry = null) => {
		if (value === null || value === undefined) {
			await client.del(PREFIX + key);
			return;
		}
		const raw = JSON.stringify(value);
		if (expiry) {
			await client.set(PREFIX + key, raw, 'PX', Math.max(1, Math.round(expiry)));
		} else {
			await client.set(PREFIX + key, raw);
		}
	};

	return client;
};

module.exports = { create, PREFIX };
