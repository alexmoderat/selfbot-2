const { defineCron } = require('../clients/modules/timers.js');
const { announceBan } = require('../services/notifications.js');
const { getBanStatusBatch } = require('../misc/twitch-gql.js');

/**
 * Prueft die per "notify ban" beobachteten Accounts auf Twitch-Sperren, aus sb-v2 (jetzt alle 5 s statt 10 s; alexmoderat, 15.11.2026, nachdem PotatBotat einen Ban 7 s nach der Kontoaenderung meldete, ganze Liste im Batch).
 * Einmal je Channel melden, dauerhaft vermerkt (Notified) - sonst kam dieselbe Sperre nach jedem Neustart erneut
 * (sodzaga, 29.07.2026). Wieder entsperrt -> Vermerk weg, die naechste Sperre wird erneut gemeldet.
 */
const BATCH_SIZE = 50;

// sb-v2 hatte hier "Account deaktiviert" - Chat-Antworten sind englisch
const REASON_TEXT = {
	DEACTIVATED: 'Account deactivated',
	TOS_INDEFINITE: 'Terms of Service',
	TOS_TEMPORARY: 'Terms of Service',
	TOS: 'Terms of Service',
	TERMS_OF_SERVICE: 'Terms of Service',
	SUSPENDED: 'Suspended',
	DMCA: 'DMCA',
};

module.exports = defineCron({
	name: 'ban-watch',
	expression: '*/5 * * * * *',
	description: 'Checks the accounts watched via "notify ban" for Twitch bans.',
	code: async function banWatch() {
		const rows = (await bot.DB.NotifyBan.find({}).lean()).map((i) => ({ Channel: i.channel, Login: i.login, Message: i.message, Notified: i.notified }));
		if (rows.length === 0) {
			return;
		}

		const logins = [...new Set(rows.map((i) => i.Login.toLowerCase()))];
		const status = new Map();
		for (let i = 0; i < logins.length; i += BATCH_SIZE) {
			try {
				for (const [login, info] of await getBanStatusBatch(logins.slice(i, i + BATCH_SIZE))) {
					status.set(login, info);
				}
			} catch (e) {
				console.warn('[ban-watch] GQL-Batch fehlgeschlagen', e);
				return; // kein Teilergebnis auswerten
			}
		}

		for (const row of rows) {
			const info = status.get(row.Login.toLowerCase());
			const channel = bot.Channels.get(row.Channel);
			if (!info || !channel) {
				continue;
			}

			const where = { channel: row.Channel, login: row.Login };
			if (!info.banned) {
				if (row.Notified) {
					await bot.DB.NotifyBan.updateOne(where, { $set: { notified: null } });
				}
				continue;
			}
			if (row.Notified || channel.mode === 'Inactive') {
				continue;
			}

			// UNKNOWN = Login loest nicht auf (auch Umbenennung/Loeschung) - roh nennen statt als Ban-Grund deuten
			const raw = String(info.banReason ?? 'UNKNOWN').toUpperCase();
			const reason = REASON_TEXT[raw] ?? info.banReason ?? 'unknown';
			await bot.DB.NotifyBan.updateOne(where, { $set: { notified: new Date() } });
			await announceBan(channel, row.Login, reason, row.Message).catch((e) => console.warn('[ban-watch]', e));
		}
	},
});

Object.assign(module.exports, { REASON_TEXT });
