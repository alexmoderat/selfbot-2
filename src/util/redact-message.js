const { DOMAIN_REGEX } = require('./text-analysis.js');

/**
 * Domains in Chat-Zitaten unschaedlich machen, bevor sie in den Mod-Log gehen (ein echter Twitch-Channel,
 * in dem der Bot selbst schreibt). Aus sb-v2s v2/utils/redact-message.ts - alexmoderat, 28.09.2026:
 * "du solltest mal die msg verbergen nicht das ich dafür gebannt werde".
 * Eigene, case-insensitive Fassung von DOMAIN_REGEX mit Leerzeichen an jeder Punktstelle ("streamboo . Com"):
 * der Text gilt hier schon als verdaechtig, ein uebersehener Punkt waere schlimmer als zu eifriges Maskieren.
 */
const LOOSE_DOMAIN_REGEX = new RegExp(DOMAIN_REGEX.source.replace(/\\\./g, '\\s*\\.\\s*'), 'gi');

const redactDomains = (text) => text.replace(LOOSE_DOMAIN_REGEX, '[link]');

/** Leerraum zusammenziehen und auf n Zeichen kappen (mit Auslassungszeichen) */
const clip = (text, length) => {
	const trimmed = text.replace(/\s+/g, ' ').trim();
	return trimmed.length > length ? `${trimmed.slice(0, length - 1)}…` : trimmed;
};

module.exports = { redactDomains, clip };
