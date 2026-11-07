const { clip, redactDomains } = require('./redact-message.js');

/**
 * Hinweis-Logik fuer bei CatQuery ueberwachte Accounts, aus sb-v2s v2/utils/monitored-notice.ts.
 * Erstnachricht -> nachschlagen -> bei "monitored" ein Hinweis ins Mod-Log. Ohne Netz und Chat testbar.
 * Schutz vor Laerm und vor einem Drittanbieter, den wir nicht fluten wollen:
 *  - Ergebnisse 6 h gemerkt (Fehlschlaege nur 60 s), gleiche Anfrage nie doppelt unterwegs
 *  - pro Account hoechstens ein Hinweis in 12 h (ein Werbe-Account in 389 Channels ergaebe sonst 389 Zeilen)
 *  - hoechstens 6 Hinweise pro Minute
 */

const CACHE_TTL = 6 * 3_600_000;
const FAIL_TTL = 60_000;
const NOTIFY_GAP = 12 * 3_600_000;
const MAX_PER_MINUTE = 6;
const MAX_CACHE = 5000;

const noticeText = (login, reason, channel, message) =>
	`👀 @${login} is monitored by CatQuery${reason ? ` (${clip(reason, 60)})` : ''} — first message in #${channel}: "${clip(redactDomains(message), 100)}"`;

const createNotifier = (deps) => {
	const now = deps.now ?? Date.now;
	const cache = new Map();
	const inflight = new Map();
	const notified = new Map();
	let sent = [];

	const status = async (login) => {
		const hit = cache.get(login);
		if (hit && now() - hit.at < (hit.ok ? CACHE_TTL : FAIL_TTL)) {
			return hit.status;
		}

		let pending = inflight.get(login);
		if (!pending) {
			pending = deps
				.lookup(login)
				.catch(() => null)
				.finally(() => inflight.delete(login));
			inflight.set(login, pending);
		}

		const result = await pending;
		if (cache.size >= MAX_CACHE) {
			cache.delete(cache.keys().next().value);
		}
		cache.set(login, { at: now(), ok: result !== null, status: result });
		return result;
	};

	/** Ueberwachungsstatus (gecacht); null bei Fehler oder unbekannt */
	const lookup = (login) => status(login.toLowerCase());

	/** Hinweis ins Mod-Log (gedrosselt); true, wenn einer gesendet wurde */
	const notify = async (loginRaw, st, channel, message) => {
		if (!st?.monitored) {
			return false;
		}

		const login = loginRaw.toLowerCase();
		const t = now();
		const last = notified.get(login);
		if (last !== undefined && t - last < NOTIFY_GAP) {
			return false;
		}

		sent = sent.filter((i) => t - i < 60_000);
		if (sent.length >= MAX_PER_MINUTE) {
			return false;
		}

		notified.set(login, t);
		sent.push(t);
		await deps.say(noticeText(login, st.reason, channel, message)).catch(() => {});
		return true;
	};

	/** Nachschlagen + Hinweis */
	const handle = async (login, channel, message) => await notify(login, await lookup(login), channel, message);

	return { handle, lookup, notify };
};

module.exports = { noticeText, createNotifier };
