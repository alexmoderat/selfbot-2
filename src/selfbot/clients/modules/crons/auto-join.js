const { Logger } = require('../../../misc/logger.js');
const { defineCron } = require('../timers.js');

const { findMissing, joinByLogin, syncModeratorModes } = require('../../../util/channel-manager.js');

/**
 * Betritt fehlende Mod-Channels, aus sb-v2s crons/auto-join: es gibt kein EventSub-Event "ich wurde irgendwo Mod",
 * also alle 2 Minuten Helix "moderated channels" abfragen (alexmoderat, 29.09.2026: sofort statt nach 20 min).
 * Danach den Mode der aktiven Channels an den Mod-Status anpassen (gemoddet -> Moderator, entmoddet -> Write).
 * In der Testphase per config-Blacklist aus (wie sb-v2: V2_AUTOJOIN=1), sonst betritt der selfbot alle Mod-Channels.
 */
const MAX_PER_CYCLE = 25; // Rate-Limit schonen

module.exports = defineCron({
	name: 'auto-join',
	expression: '0 */2 * * * *',
	description: 'Joins missing channels (new mod channels) and keeps the channel mode in sync with the mod status.',
	code: async function autoJoin() {
		const missing = await findMissing();
		if (missing && missing.length > 0) {
			const batch = missing.slice(0, MAX_PER_CYCLE);
			Logger.info(`[auto-join] ${missing.length} fehlend, ${batch.length} in diesem Durchlauf`);
			for (const item of batch) {
				await joinByLogin(item.login).catch((e) => Logger.warn(`[auto-join] #${item.login}`, e));
			}
		}

		await syncModeratorModes().catch((e) => Logger.warn('[auto-join] Mod-Abgleich fehlgeschlagen', e));
	},
});
