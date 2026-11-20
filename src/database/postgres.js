const { Pool, types } = require('pg');

// Postgres wie bei DontAddThisBot (bot.SQL = pg-Pool), Verbindung aus config.json ("postgres": { host, port, user, password, database }).
// Der Pool entsteht erst bei open(), damit die Modelle schon beim Laden darauf zeigen koennen.

// bigint (Zaehler, IDs, count) und numeric kommen als Zahl statt als Text
types.setTypeParser(20, Number);
types.setTypeParser(1700, Number);

let pool = null;

const current = () => {
	if (!pool) {
		throw new Error('Postgres ist nicht verbunden (postgres.open fehlt)');
	}
	return pool;
};

module.exports = {
	open(config) {
		if (!pool) {
			pool = new Pool({ ...config, max: config.max ?? 10, connectionTimeoutMillis: 10_000 });
			pool.on('error', (error) => bot.Logger?.error('[db] Postgres-Fehler', error));
		}
		return pool;
	},
	query: (text, values) =>
		current()
			.query(text, values)
			.catch((error) => {
				// Der Text hilft bei der Fehlersuche (Parameter bleiben draussen, sie koennen Chat-Inhalte enthalten)
				error.sql = String(text).slice(0, 500);
				throw error;
			}),
	connect: () => current().connect(),
	async end() {
		if (pool) {
			const old = pool;
			pool = null;
			await old.end();
		}
	},
};
