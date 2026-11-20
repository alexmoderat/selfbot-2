const { Pool } = require('pg');
const { Logger } = require('../misc/logger.js');

// Geteilte Daten des utility-Bots (Postgres-DB utility_next, vorher MariaDB chat_data): Sichtungen des Network-Bot-Radars,
// Sub-Zaehler, laengste Subs, bekannte Bots, Reminder, Command-Protokoll. Gehoeren utility-next (/root/utility-next); dieser Bot liest
// mit und schreibt nur wenige Dinge zurueck (eigene Sichtungen, Bot-Liste per API, Sub-Zaehler-Schalter, Reminder aendern/loeschen).
// Zugang ueber config.json "utilityPostgres" (eigene Rolle mit begrenzten Rechten).
//
// Abfragen wie bisher mit "?"-Platzhaltern (werden zu $1, $2, ...); das Ergebnis ist ein Array von Zeilen mit affectedRows.

let pool = null;

const getPool = () => {
	if (!pool) {
		const config = bot.Config.utilityPostgres;
		if (!config) {
			throw new Error('config.json "utilityPostgres" fehlt (Zugang zur DB utility_next)');
		}
		pool = new Pool({ ...config, max: 4, connectionTimeoutMillis: 10_000 });
		pool.on('error', (error) => Logger.warn('[utility-db] Postgres-Fehler', error.message));
	}
	return pool;
};

/** "?" -> "$1", "$2", ... (nicht in Zeichenketten in einfachen Anfuehrungszeichen) */
const numbered = (sql) => {
	let count = 0;
	return sql
		.split(/('(?:[^']|'')*')/)
		.map((part) => (part.startsWith("'") ? part : part.replaceAll('?', () => `$${++count}`)))
		.join('');
};

/**
 * Abfrage mit Platzhaltern: await utility.query('SELECT ... WHERE user_id = ?', [id])
 * @returns {Promise<any[] & { affectedRows: number }>}
 */
const query = async (sql, params = []) => {
	try {
		const result = await getPool().query(numbered(sql), params);
		return Object.assign(result.rows, { affectedRows: result.rowCount ?? 0 });
	} catch (e) {
		Logger.warn('[utility-db] Abfrage fehlgeschlagen', e.message);
		throw e;
	}
};

const end = async () => {
	await pool?.end();
	pool = null;
};

module.exports = { query, end, numbered };
