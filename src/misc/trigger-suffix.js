const { trimMessage } = require('../util/twitch/utils.js');

/**
 * Ausloesenden Befehl in Klammern ans Ende der Antwort haengen, z. B. '... this year] [!ll]' - nur fuer ninou2, wenn sie
 * selbst einen Command ausloest (ninou2, 13.11.2026: "can i get it for me only ( when me the user trigger the command )";
 * Ziel: Antworten in den Logs leichter finden). alexmoderat hatte die Variante fuer alle am 11.11.2026 entfernt (3dae0be),
 * deshalb bewusst nur fuer diesen einen User. !csi (streaminfoschange, auch !sic/!sci) bleibt ohne, weil dessen Antwort
 * zum Zurueckkopieren gedacht ist. Bei mehrteiligen Antworten nur an der letzten Nachricht.
 */
const SUFFIX_USER_IDS = new Set([4293]); // ninou2
const EXCLUDED_COMMANDS = new Set(['streaminfoschange']);
const LIMIT = 500;

const triggerOf = (msg) => {
	if (!msg?.invocation || !SUFFIX_USER_IDS.has(msg.sender?.id) || EXCLUDED_COMMANDS.has(msg.commandName)) {
		return null;
	}

	return `[${(msg.prefix ?? '!').trim()}${msg.invocation}]`;
};

/** Text mit angehaengtem Befehl; der Text wird gekuerzt, damit beides ins Nachrichtenlimit passt */
const withTrigger = (text, msg, limit = LIMIT) => {
	const trigger = triggerOf(msg);
	if (!trigger || !text) {
		return text;
	}

	return `${trimMessage(text, limit - trigger.length - 1)} ${trigger}`;
};

module.exports = { withTrigger, triggerOf, EXCLUDED_COMMANDS, SUFFIX_USER_IDS };
