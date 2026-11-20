// Zustand zu markierten Usern (Twitchs "Suspicious User Controls"), aus sb-v2s v2/singletons/low-trust.ts.
// Gefuellt vom Modul low-trust (PubSub low-trust-users); banphrase-filter und andere Module lesen mit.

/** User-IDs unter Beobachtung (ACTIVE_MONITORING oder RESTRICTED) */
const suspiciousUsers = new Set();
/** User-IDs mit RESTRICTED oder LIKELY_EVADER - Teilmenge von suspiciousUsers, ausser bei LIKELY_EVADER ohne Status */
const banEvaders = new Set();

const isBanEvader = (userId) => banEvaders.has(String(userId));
const isSuspicious = (userId) => suspiciousUsers.has(String(userId));

/**
 * Behandlungsstatus uebernehmen. Twitch liefert den Wert GROSSGESCHRIEBEN ("RESTRICTED" ...) -
 * in sb-v2 wurde frueher gegen Kleinschreibung verglichen, dadurch fiel jedes Event durch.
 * @returns was sich geaendert hat, fuers Log
 */
const applyTreatment = (userId, status) => {
	const uid = String(userId);
	const st = String(status || '').toLowerCase();
	if (st === 'restricted') {
		banEvaders.add(uid);
		suspiciousUsers.add(uid);
		return 'restricted';
	} else if (st === 'active_monitoring') {
		suspiciousUsers.add(uid);
		return 'monitoring';
	} else if (st === 'no_treatment') {
		suspiciousUsers.delete(uid);
		banEvaders.delete(uid);
		return 'cleared';
	}

	return null;
};

/** LIKELY_EVADER aus der Ban-Evasion-Bewertung, auch ohne Behandlungsstatus */
const markEvader = (userId) => {
	banEvaders.add(String(userId));
};

/** Nur fuer Tests */
const _reset = () => {
	suspiciousUsers.clear();
	banEvaders.clear();
};

module.exports = { suspiciousUsers, banEvaders, isBanEvader, isSuspicious, applyTreatment, markEvader, _reset };
