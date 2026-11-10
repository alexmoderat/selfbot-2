const { trimMessage } = require('../util/twitch/utils.js');

/**
 * Ausloesenden Befehl ans Ende jeder Command-Antwort haengen, z. B. '... this year]. "!ll"' (ninou2, 10.11.2026: "we
 * want the alias to be shown on all commands response, then only for !csi it should not show it", Ziel: "to make it
 * easy when [searching] the logs ... for a specific response from the [bot] to a command"). alexmoderat, 10.11.2026:
 * in allen Channels, auch fuer Custom Commands. !csi (streaminfoschange, auch !sic/!sci) bleibt ohne, weil dessen
 * Antwort zum Zurueckkopieren gedacht ist. Bei mehrteiligen Antworten nur an der letzten Nachricht.
 */
const EXCLUDED_COMMANDS = new Set(['streaminfoschange']);
const LIMIT = 500;

const triggerOf = (msg) => {
	if (!msg?.invocation || EXCLUDED_COMMANDS.has(msg.commandName)) {
		return null;
	}

	return `"${(msg.prefix ?? '!').trim()}${msg.invocation}"`;
};

/** Text mit angehaengtem Befehl; der Text wird gekuerzt, damit beides ins Nachrichtenlimit passt */
const withTrigger = (text, msg, limit = LIMIT) => {
	const trigger = triggerOf(msg);
	if (!trigger || !text) {
		return text;
	}

	const body = trimMessage(text, limit - trigger.length - 2);
	return /[.!?…]$/.test(body) ? `${body} ${trigger}` : `${body}. ${trigger}`;
};

module.exports = { withTrigger, triggerOf, EXCLUDED_COMMANDS };
