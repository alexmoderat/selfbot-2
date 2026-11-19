const { parseDurationText } = require('./duration.js');

/**
 * Reine Timer-Logik (alexmoderat, 31.10.2026: "ja wir sollten mal timer adden", Anlass ninou2: Promo-Text
 * "each 4/6 hours"). Ohne DB/Netz, damit testbar - Speicherung in singletons/timers.ts, Versand in crons/timers.
 */
const MIN_INTERVAL = 5 * 60_000;
const MAX_INTERVAL = 7 * 86_400_000;
const MAX_TIMERS_PER_CHANNEL = 10;
const MAX_MESSAGE_LENGTH = 450;

/** "4h", "1h30m", "90m" -> ms, ausserhalb 5 min bis 7 Tage -> null */
const parseTimerInterval = (input) => {
	if (!/^(\d+\s*[dhms]\s*)+$/i.test(input.trim())) {
		return null;
	}

	const ms = parseDurationText(input);
	return ms !== null && ms >= MIN_INTERVAL && ms <= MAX_INTERVAL ? ms : null;
};

/** Intervall genau anzeigen, mit Sekunden ("1h 10s" statt gerundet "1h" - alexmoderat, 19.11.2026) */
const formatInterval = (seconds) => {
	const total = Math.round(seconds);
	const units = [
		['d', 86_400],
		['h', 3600],
		['m', 60],
		['s', 1],
	];
	const parts = [];
	let rest = total;
	for (const [unit, size] of units) {
		const n = Math.floor(rest / size);
		rest -= n * size;
		if (n > 0) {
			parts.push(`${n}${unit}`);
		}
	}
	return parts.join(' ') || '0s';
};

/** Anzeige der Live-Bedingung */
const timerMode = (timer) => (timer.Offline_Only ? 'offline only' : timer.Online_Only ? 'live only' : 'always');

/**
 * Faellig, wenn aktiv, (bei Online_Only) live bzw. (bei Offline_Only) offline, (bei Live_Channel) der andere Channel live und das Intervall seit dem letzten Senden um ist. Noch nie gesendet
 * -> sofort, d. h. ein neuer Timer meldet sich im naechsten Cron-Tick. "live" null (unbekannt) zaehlt als offline,
 * damit ein Online-Timer bei API-Problemen lieber schweigt als in einen leeren Chat zu posten; ein Offline-Timer schweigt
 * bei unbekanntem Status ebenfalls (lieber nicht in einen laufenden Stream posten).
 */
const isTimerDue = (timer, live, now, otherLive = null) => {
	if (!timer.Enabled || (timer.Online_Only && live !== true) || (timer.Offline_Only && live !== false)) {
		return false;
	}
	// whenlive: der andere Channel muss sicher live sein
	if (timer.Live_Channel && otherLive !== true) {
		return false;
	}

	return timer.Last_Sent === null || now - timer.Last_Sent >= timer.Interval_Seconds * 1000;
};

/**
 * Timer einer Sync-Gruppe zaehlen das Intervall ab dem letzten Senden irgendeines Timers der Gruppe (ninou2, 19.11.2026:
 * "should Sync both chats too", "if a +ed has been sent in an offline chat, the next one should be sent after 1h10s in the
 * next offline chat" - DeepDankDungeonBot hat einen gemeinsamen Cooldown fuer beide Chats). Liefert den Timer mit dem
 * spaetesten Last_Sent der Gruppe; ohne Gruppe unveraendert.
 */
const withGroupLastSent = (timer, all) => {
	if (!timer.Sync_Group) {
		return timer;
	}
	const latest = all
		.filter((t) => t.Sync_Group === timer.Sync_Group)
		.reduce((max, t) => (t.Last_Sent && (!max || t.Last_Sent > max) ? t.Last_Sent : max), timer.Last_Sent ?? null);
	return { ...timer, Last_Sent: latest };
};

module.exports = { withGroupLastSent, MIN_INTERVAL, MAX_INTERVAL, MAX_TIMERS_PER_CHANNEL, MAX_MESSAGE_LENGTH, parseTimerInterval, isTimerDue, timerMode, formatInterval };
