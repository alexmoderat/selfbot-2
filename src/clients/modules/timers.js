const { readdirSync, existsSync } = require('node:fs');
const path = require('node:path');
const cron = require('node-cron');
const { filterByConfig } = require('../../config.js');
const { Logger } = require('../../misc/logger.js');

// Crons wie DontAddThisBot (node-cron, Datei clients/modules/timers.js), Definitionen wie bisher in clients/modules/crons/*.js:
//   module.exports = defineCron({ name, expression, description, code() {} })
// expression mit Sekunden-Feld (6 Felder) wie im alten Bot. Ein Lauf gleichzeitig, sonst stapeln sich langsame Crons.

const CRON_DIR = path.join(__dirname, 'crons');
const tasks = [];

/** Nur Durchreichen (bisher classes/cron.ts) */
const defineCron = (definition) => definition;

const schedule = (definition) => {
	let running = false;
	const wrapper = { name: definition.name, description: definition.description, expression: definition.expression };
	const code = definition.code.bind(wrapper);

	wrapper.task = cron.schedule(definition.expression, async () => {
		if (running) {
			return;
		}
		running = true;
		try {
			await code();
		} catch (e) {
			Logger.warn('Cron-Fehler', { cron: definition.name, error: e });
		} finally {
			running = false;
		}
	});
	wrapper.stop = () => wrapper.task.stop();
	return wrapper;
};

const getTimers = (config) => {
	const files = existsSync(CRON_DIR) ? readdirSync(CRON_DIR).filter((file) => file.endsWith('.js')) : [];
	const definitions = files.map((file) => require(path.join(CRON_DIR, file)));
	for (const definition of filterByConfig(definitions, (i) => i.name, config.modules.crons)) {
		if (!cron.validate(definition.expression)) {
			throw new Error(`Cron ${definition.name}: ungueltiger Ausdruck "${definition.expression}"`);
		}
		tasks.push(schedule(definition));
	}
	return tasks;
};

const stopTimers = () => {
	for (const task of tasks.splice(0)) {
		task.stop();
	}
};

module.exports = { defineCron, getTimers, stopTimers, tasks };
