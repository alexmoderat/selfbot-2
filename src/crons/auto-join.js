const { defineCron } = require('../clients/modules/timers.js');

const { findMissing, joinByLogin } = require('../services/channel-manager.js');

/**
 * Betritt fehlende Mod-Channels, aus sb-v2s crons/auto-join: es gibt kein EventSub-Event "ich wurde irgendwo Mod",
 * also alle 2 Minuten Helix "moderated channels" abfragen (alexmoderat, 29.09.2026: sofort statt nach 20 min).
 * Dazu fehlende EventSub-Abos nachziehen (z. B. nach Demod verloren gegangen).
 * In der Testphase per config-Blacklist aus (wie sb-v2: V2_AUTOJOIN=1), sonst betritt der selfbot alle Mod-Channels.
 */
const MAX_PER_CYCLE = 25; // Rate-Limit schonen

module.exports = defineCron({
	name: 'auto-join',
	expression: '0 */2 * * * *',
	description: 'Joins missing channels (new mod channels) and re-creates missing EventSub subscriptions.',
	code: async function autoJoin() {
		const missing = await findMissing();
		if (missing && missing.length > 0) {
			const batch = missing.slice(0, MAX_PER_CYCLE);
			console.log(`[auto-join] ${missing.length} fehlend, ${batch.length} in diesem Durchlauf`);
			for (const item of batch) {
				await joinByLogin(item.login).catch((e) => console.warn(`[auto-join] #${item.login}`, e));
			}
		}

		const platform = bot.Twitch;
		await platform.syncSubscriptions().catch((e) => console.warn('[auto-join] EventSub-Nachzug fehlgeschlagen', e));
	},
});
