const { readdir, stat, statfs } = require('node:fs/promises');
const { defineCron } = require('../timers.js');
const { sendAlert } = require('../../../util/moderation.js');

/**
 * Warnt per Discord, wenn der Plattenplatz knapp wird, aus sb-v2s crons/disk-watch (stuendlich). Stufen: unter
 * DISK_WARN_GB (5) "knapp", unter DISK_CRIT_GB (2) "kritisch"; Wiederholung hoechstens alle 24 h, sofort bei
 * Verschaerfung, einmal Entwarnung. Dazu die Groessen der ueblichen Verdaechtigen (justlog-Logs, /var/log).
 */
const warnGb = () => Number(process.env.DISK_WARN_GB) || 5;
const criticalGb = () => Number(process.env.DISK_CRIT_GB) || 2;
const REPEAT = 24 * 60 * 60 * 1000;

let lastLevel = 'ok';
let lastNotice = 0;

const gb = (bytes) => bytes / 1024 ** 3;

const formatSize = (bytes) => {
	if (bytes >= 1024 ** 3) {
		return `${(bytes / 1024 ** 3).toFixed(1)} GB`;
	} else if (bytes >= 1024 ** 2) {
		return `${Math.round(bytes / 1024 ** 2)} MB`;
	}

	return `${Math.round(bytes / 1024)} KB`;
};

const directorySize = async (path) => {
	try {
		let sum = 0;
		for (const entry of await readdir(path, { withFileTypes: true })) {
			const full = `${path}/${entry.name}`;
			if (entry.isDirectory()) {
				sum += await directorySize(full);
			} else if (entry.isFile()) {
				sum += (await stat(full)).size;
			}
		}

		return sum;
	} catch {
		return 0;
	}
};

const levelFor = (freeGb, warn, critical) => (freeGb < critical ? 'critical' : freeGb < warn ? 'warn' : 'ok');

module.exports = defineCron({
	name: 'disk-watch',
	expression: '0 7 * * * *',
	description: 'Warns when free disk space runs low.',
	code: async function diskWatch() {
		const s = await statfs('/');
		const free = gb(s.bavail * s.bsize);
		const total = gb(s.blocks * s.bsize);
		const usedPercent = Math.round((1 - s.bavail / s.blocks) * 100);
		const level = levelFor(free, warnGb(), criticalGb());

		if (level === 'ok') {
			if (lastLevel !== 'ok') {
				console.log(`[disk-watch] wieder entspannt: ${free.toFixed(1)} GB frei`);
				await sendAlert(`✅ Platte wieder entspannt: **${free.toFixed(1)} GB** frei (${usedPercent}% belegt)`);
			}

			lastLevel = 'ok';
			lastNotice = 0;
			return;
		}

		const worsened = level === 'critical' && lastLevel !== 'critical';
		const repeatDue = Date.now() - lastNotice > REPEAT;
		lastLevel = level;
		if (!worsened && !repeatDue) {
			return;
		}

		lastNotice = Date.now();
		const [logs, varLog] = await Promise.all([directorySize('/root/justlog/logs'), directorySize('/var/log')]);
		const icon = level === 'critical' ? '🔴' : '⚠️';
		const text =
			`${icon} **Plattenplatz ${level === 'critical' ? 'kritisch' : 'knapp'}**: ` +
			`${free.toFixed(1)} GB frei von ${total.toFixed(0)} GB (${usedPercent}% belegt)\n` +
			`justlog-Logs: ${formatSize(logs)} · /var/log: ${formatSize(varLog)}`;

		console.warn(`[disk-watch] ${level}: ${free.toFixed(1)} GB frei (${usedPercent}% belegt), justlog ${formatSize(logs)}, /var/log ${formatSize(varLog)}`);
		await sendAlert(text);
	},
});

Object.assign(module.exports, { formatSize, levelFor });
