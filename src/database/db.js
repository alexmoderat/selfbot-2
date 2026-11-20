const { Logger } = require('../misc/logger.js');
const sql = require('./postgres.js');
const coreModels = require('./models/index.js');
const { dataModels, dataSpecs, counterOf, toRow, fromRow } = require('./models/data.js');

const { createRowFactory } = require('./row.js');

const models = { ...coreModels, ...dataModels };

// Postgres wie bei DontAddThisBot (bot.SQL = pg-Pool); bot.DB.<Model> bedient die Tabellen weiter wie die frueheren
// Mongoose-Modelle (find/findOne/updateOne/aggregate/...), uebersetzt in SQL (orm/).

let expireTimer = null;

const connect = async (config) => {
	sql.open(config);
	await sql.query('SELECT 1');
	await Promise.all(Object.values(models).map((model) => model.init()));
	Logger.info('[db] Mit Postgres verbunden');

	// Ersatz fuer die TTL-Indizes von MongoDB (JoinerMessage, JoinerBan): stuendlich alte Zeilen loeschen
	const expire = () =>
		Promise.all(Object.values(models).map((model) => model.expire())).catch((e) => Logger.warn('[db] Aufraeumen fehlgeschlagen', e.message));
	void expire();
	expireTimer = setInterval(expire, 60 * 60_000);
	expireTimer.unref();
};

/** Naechste numerische ID fuer eine Tabelle (wie AUTO_INCREMENT), atomar ueber "counters" */
const nextId = async (name) => {
	const { rows } = await sql.query(
		'INSERT INTO "counters" ("_id", "seq") VALUES ($1, 1) ON CONFLICT ("_id") DO UPDATE SET "seq" = "counters"."seq" + 1 RETURNING "seq"',
		[name],
	);
	return rows[0].seq;
};

/** Zaehler mindestens auf value setzen (nach der Migration: hoechste uebernommene ID) */
const ensureCounterAtLeast = async (name, value) => {
	await sql.query(
		'INSERT INTO "counters" ("_id", "seq") VALUES ($1, $2) ON CONFLICT ("_id") DO UPDATE SET "seq" = GREATEST("counters"."seq", EXCLUDED."seq")',
		[name, value],
	);
};

const disconnect = async () => {
	clearInterval(expireTimer);
	await sql.end();
};

/** Dokument mit naechster numerischer ID anlegen (Collections mit Zaehler, z. B. ModerationBanLog) */
const createWithId = async (modelName, data) => {
	const counter = counterOf(modelName);
	if (!counter) {
		throw new Error(`${modelName} hat keine numerische ID`);
	}
	return await models[modelName].create({ _id: await nextId(counter), ...data });
};

/** Ersatz fuer core.Query.getRow: bot.DB.getRow('Suggestion') */
const getRow = createRowFactory({ models, toRow, fromRow, counterOf, nextId });

module.exports = { ...models, connect, disconnect, nextId, ensureCounterAtLeast, createWithId, getRow, dataSpecs, toRow, fromRow, counterOf };
