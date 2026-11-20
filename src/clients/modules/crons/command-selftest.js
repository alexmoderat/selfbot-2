const { defineCron } = require('../timers.js');
const { getCommand, isResultFailure } = require('../commands.js');
const { sendAlert } = require('../../../util/moderation.js');

/**
 * Selbsttest (ninou2, 12.11.2026: "internally test the commands and report to alex if any broken"; Anlass: !vod war
 * tagelang kaputt, ohne dass es jemand merkte). Fuehrt alle 10 Minuten lesende Commands intern aus (kein Chat, keine
 * Nebenwirkungen) und meldet per Discord, sobald einer 2x in Folge ausfaellt, sowie die Entwarnung.
 * Nur Commands ohne Schreibzugriff: nichts mit ban/set*, remind, timer, join & Co.
 */
const PROBES = [
	{ command: 'id', args: ['alexmoderat'] },
	{ command: 'accountage', args: ['alexmoderat'] },
	{ command: 'followers', args: ['alexmoderat'] },
	{ command: 'followage', args: ['alexmoderat', 'ninou2'] },
	{ command: 'lastlive', args: ['ninou2'] },
	{ command: 'hoursstreamed', args: ['ninou2'] },
	{ command: 'mods', args: ['alexmoderat'] },
	{ command: 'isdown', args: ['twitch.tv'] },
];

const TIMEOUT = 20_000;
const FAILURES_BEFORE_ALERT = 2;
const REPEAT = 24 * 60 * 60 * 1000;
const FAILURE_TEXT = /\b(failed to|could not|couldn't|something went wrong|unexpected error|not available|unauthori[sz]ed|invalid token)\b/i;

/** Pro Command: erst nach 2 Fehlschlaegen in Folge melden, taeglich erinnern, einmal entwarnen */
const evaluate = (state, healthy, now) => {
	if (healthy) {
		const wasAlerting = state.alerting;
		state.failures = 0;
		state.alerting = false;
		state.lastAlertAt = 0;
		return wasAlerting ? 'recover' : null;
	}

	state.failures++;
	if (state.failures < FAILURES_BEFORE_ALERT) {
		return null;
	} else if (!state.alerting) {
		state.alerting = true;
		state.lastAlertAt = now;
		return 'alert';
	} else if (now - state.lastAlertAt >= REPEAT) {
		state.lastAlertAt = now;
		return 'repeat';
	}

	return null;
};

/** Bewertet das Ergebnis eines Commands: leer = ok, sonst der Grund */
const judge = (result, replies) => {
	const text = [...replies, result?.text].filter((i) => typeof i === 'string').join(' ');
	if (isResultFailure(result) && FAILURE_TEXT.test(text)) {
		return `Fehlerantwort: ${text.slice(0, 120)}`;
	} else if (!text.trim()) {
		return 'keine Antwort';
	} else if (FAILURE_TEXT.test(text)) {
		return `Fehlerantwort: ${text.slice(0, 120)}`;
	}

	return '';
};

const runProbe = async (probe, sender) => {
	const command = getCommand(probe.command);
	if (!command) {
		return 'Command nicht geladen';
	}

	const replies = [];
	const msg = {
		displayName: 'selftest',
		channelData: { name: 'alexmoderat', Name: 'alexmoderat' },
		sender,
		prefix: '!',
		invocation: probe.command,
		args: probe.args,
		params: {},
		debug: true,
		send: async (text) => {
			replies.push(text);
		},
		getBestAvailableEmote: async (emotes, fallback) => fallback,
	};

	try {
		const result = await Promise.race([command.execute(bot.Client, msg), new Promise((_, reject) => setTimeout(() => reject(new Error('Timeout')), TIMEOUT).unref())]);
		return judge(result, replies);
	} catch (e) {
		return `Exception: ${e?.message ?? e}`;
	}
};

const states = new Map();

const runSelftest = async (now = Date.now()) => {
	const sender = await bot.Users.get('alexmoderat').catch(() => null);
	const alerts = [];
	const recovered = [];
	const failed = [];
	for (const probe of PROBES) {
		const why = await runProbe(probe, sender);
		if (why) {
			failed.push(`${probe.command}: ${why}`);
		}

		const state = states.get(probe.command) ?? { failures: 0, alerting: false, lastAlertAt: 0 };
		states.set(probe.command, state);
		const action = evaluate(state, !why, now);
		if (action === 'recover') {
			recovered.push(probe.command);
		} else if (action) {
			alerts.push(`${probe.command}: ${why}${action === 'repeat' ? ' (weiterhin kaputt)' : ''}`);
		}
	}

	console.log(`[command-selftest] ${PROBES.length - failed.length}/${PROBES.length} ok`);
	if (failed.length > 0) {
		console.warn(`[command-selftest] ${failed.length}/${PROBES.length} fehlgeschlagen: ${failed.join(' | ')}`);
	}
	if (alerts.length > 0) {
		await sendAlert(`🔴 **Command-Selbsttest**: ${alerts.length} Command(s) kaputt\n${alerts.map((i) => `• ${i}`).join('\n')}`);
	}
	if (recovered.length > 0) {
		await sendAlert(`✅ **Command-Selbsttest**: wieder ok: ${recovered.join(', ')}`);
	}

	return { failed, alerts, recovered };
};

module.exports = defineCron({
	name: 'command-selftest',
	expression: '0 */10 * * * *',
	description: 'Runs read-only commands internally and reports broken ones via Discord.',
	code: async function commandSelftest() {
		await runSelftest();
	},
});

Object.assign(module.exports, { PROBES, evaluate, judge, runSelftest });
