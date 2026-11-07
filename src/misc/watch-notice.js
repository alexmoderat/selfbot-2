const { clip, redactDomains } = require('./redact-message.js');

/**
 * Meldung fuer beobachtete Accounts (!watchalert), aus sb-v2s v2/utils/watch-notice.ts: jede Nachricht im Mod-Log,
 * aber gedrosselt - pro Account und Channel hoechstens eine Meldung in 30 Minuten, insgesamt hoechstens 10 pro Minute.
 */

const GAP = 30 * 60_000;
const MAX_PER_MINUTE = 10;
const MAX_KEYS = 5000;

const watchNoticeText = (login, reason, channel, message) =>
	`👀 @${login} (watched${reason ? `: ${clip(reason, 60)}` : ''}) in #${channel}: "${clip(redactDomains(message), 120)}"`;

const createWatchNotifier = (deps) => {
	const now = deps.now ?? Date.now;
	const last = new Map();
	let sent = [];

	/** true, wenn eine Meldung gesendet wurde */
	const handle = async (login, reason, channel, message) => {
		const t = now();
		const key = `${login.toLowerCase()}#${channel}`;
		const previous = last.get(key);
		if (previous !== undefined && t - previous < GAP) {
			return false;
		}

		sent = sent.filter((i) => t - i < 60_000);
		if (sent.length >= MAX_PER_MINUTE) {
			return false;
		}

		if (last.size >= MAX_KEYS) {
			last.delete(last.keys().next().value);
		}
		last.set(key, t);
		sent.push(t);
		await deps.say(watchNoticeText(login, reason, channel, message)).catch(() => {});
		return true;
	};

	return { handle };
};

module.exports = { watchNoticeText, createWatchNotifier };
