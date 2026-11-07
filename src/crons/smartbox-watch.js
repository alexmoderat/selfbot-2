const { defineCron } = require('../clients/modules/timers.js');
const { sendAlert } = require('../services/moderation.js');
const { gqlSmartbox } = require('../misc/twitch-gql.js');

/**
 * Meldet per Discord, sobald der SmartBox-GQL-Zugang nicht mehr geht, aus sb-v2 (alexmoderat, 02.10.2026: "Bin gespannt
 * wann Twitch das dicht macht"). Probe: user.relationship eines beliebigen Paars - mit gueltigem Token ein Objekt,
 * bei Sperre/ungueltigem Token null oder ein HTTP-Fehler. Ohne SMARTBOX_GQL_* still aus.
 */
const TWITCH_USER_ID = '12826';
const FAILURES_BEFORE_ALERT = 2;
const REPEAT = 24 * 60 * 60 * 1000;

const newHealthState = () => ({ failures: 0, alerting: false, lastAlertAt: 0 });

/** Erst nach 2 Fehlschlaegen in Folge melden (transiente GQL-Fehler), hoechstens taeglich erinnern, einmal entwarnen */
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

const state = newHealthState();

module.exports = defineCron({
	name: 'smartbox-watch',
	expression: '0 */30 * * * *',
	description: 'Checks SmartBox GQL access and reports outages via Discord.',
	code: async function smartboxWatch() {
		if (!process.env.SMARTBOX_GQL_CLIENT_ID || !process.env.SMARTBOX_GQL_TOKEN) {
			return;
		}

		const selfName = bot.Twitch.selfName;
		let ok = false;
		let why = '';
		try {
			const data = await gqlSmartbox(`query {
				user(login: ${JSON.stringify(selfName)} lookupType: ALL) {
					relationship(targetUserID: "${TWITCH_USER_ID}") { followedAt }
				}
			}`);
			ok = Boolean(data?.user?.relationship);
			why = ok ? '' : 'Antwort ohne relationship (Integrity-Sperre oder Token ungueltig)';
		} catch (e) {
			why = `HTTP-Fehler: ${e.message}`;
		}

		const action = evaluate(state, ok, Date.now());
		if (action === 'recover') {
			await sendAlert(
				'✅ **SmartBox-GQL wieder erreichbar** — subage, chatters (Nicht-Mod-Channels) und der Editor-Weg von settitle/setgame laufen wieder.',
			);
		} else if (action) {
			await sendAlert(
				`🔴 **SmartBox-GQL ausgefallen** (${why})\n` +
					'Betroffen: subage, chatters in Nicht-Mod-Channels, Editor-Weg von settitle/setgame.\n' +
					'Token neu aus Moltorino holen und in .env unter SMARTBOX_GQL_TOKEN eintragen; falls Twitch die Client-Id gesperrt hat, Alternative suchen.' +
					(action === 'repeat' ? '\n(Erinnerung: weiterhin ausgefallen)' : ''),
			);
		}
	},
});

Object.assign(module.exports, { FAILURES_BEFORE_ALERT, REPEAT, newHealthState, evaluate });
