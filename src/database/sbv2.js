const mariadb = require('mariadb');
const { Logger } = require('../misc/logger.js');

// Geteilte Daten von sb-v2 und utility-bot (MariaDB-Schema chat_data): first_message_sightings, chat_logs, longest_sub,
// global_sub_counter, watch_streak_progress, ... Diese Tabellen gehoeren nicht diesem Bot, andere Bots schreiben sie
// laufend weiter - deshalb bleiben sie in MariaDB und werden hier nur ueber Platzhalter abgefragt.
// Alle eigenen Daten des Bots liegen in Postgres.

let pool = null;

const getPool = () => {
	if (!pool) {
		const { MARIA_USER, MARIA_PASSWORD, MARIA_HOST } = process.env;
		if (!MARIA_USER || !MARIA_PASSWORD || !MARIA_HOST) {
			throw new Error('MARIA_USER, MARIA_PASSWORD und MARIA_HOST fehlen in .env (geteilte sb-v2-Daten)');
		}
		pool = mariadb.createPool({
			host: MARIA_HOST,
			user: MARIA_USER,
			password: MARIA_PASSWORD,
			connectionLimit: 4,
			bigIntAsNumber: true,
			insertIdAsNumber: true,
		});
	}
	return pool;
};

/**
 * Abfrage mit Platzhaltern: await sbv2.query('SELECT ... WHERE user_id = ?', [id])
 * @returns {Promise<any[] & { affectedRows?: number }>}
 */
const query = async (sql, params = []) => {
	try {
		return await getPool().query(sql, params);
	} catch (e) {
		Logger.warn('[sbv2] Abfrage fehlgeschlagen', e.message);
		throw e;
	}
};

const end = async () => {
	await pool?.end();
	pool = null;
};

module.exports = { query, end };
