// Erkennt Command-Aufrufe wie sb-v2s Router.parseInvocation:
//   "<prefix> ping"  (Prefix + Leerzeichen, z. B. "sb ping")
//   "<prefix>ping"   (Prefix direkt am Command, z. B. "?ping")
//   "!ping"          (Zweit-Prefix, nur fuer Commands mit Flag "no-prefix")
// Ein nacktes Wort ohne Prefix loest nie etwas aus.

const ALT_PREFIX = '!';

/**
 * Grund, warum ein Prefix nicht geht, sonst null. Hoechstens 3 Zeichen, damit niemand Namen als Prefix setzt
 * (pumpi3, 03.11.2026). "/" und "." sind Twitchs eigene Befehle, Leerzeichen kann parseInvocation nicht.
 */
const prefixProblem = (prefix) => {
	if (/\s/.test(prefix)) {
		return "it can't contain spaces";
	}
	else if ([...prefix].length > 3) {
		return 'it can be 3 characters at most';
	}
	else if (prefix.startsWith('/') || prefix.startsWith('.')) {
		return 'Twitch uses / and . for its own commands';
	}
	return null;
};

/**
 * @returns {{ invocation: string, args: string[], altOnly: boolean, usedPrefix: string } | null}
 * altOnly: kam ueber das Zweit-Prefix, ohne dass ein no-prefix-Command passt (dann nur Custom Commands)
 */
const parseInvocation = (message, prefix, isNoPrefixCommand, altPrefix = ALT_PREFIX) => {
	const trimmed = message.trim();
	const lower = trimmed.toLowerCase();
	const p = prefix.toLowerCase();
	const words = trimmed.split(/\s+/);
	const firstToken = (words[0] ?? '').toLowerCase();

	// Zweit-Prefix zuerst, sonst wuerde bei Prefix "!" alles darueber laufen
	// altPrefix null = Zweit-Prefix aus (Parallelbetrieb mit dem alten selfbot, der "!" schon beantwortet)
	if (altPrefix && altPrefix !== p && firstToken.startsWith(altPrefix) && firstToken.length > altPrefix.length) {
		const invocation = firstToken.slice(altPrefix.length);
		return { invocation, args: words.slice(1), altOnly: !isNoPrefixCommand(invocation), usedPrefix: altPrefix };
	}

	if (lower.startsWith(`${p} `)) {
		const rest = trimmed
			.slice(p.length + 1)
			.trim()
			.split(/\s+/)
			.filter(Boolean);
		if (rest.length === 0) {
			return null;
		}
		return { invocation: rest[0].toLowerCase(), args: rest.slice(1), altOnly: false, usedPrefix: `${prefix} ` };
	}

	if (lower.startsWith(p) && trimmed.length > p.length) {
		const rest = trimmed.slice(p.length).trim().split(/\s+/).filter(Boolean);
		if (rest.length === 0) {
			return null;
		}
		return { invocation: rest[0].toLowerCase(), args: rest.slice(1), altOnly: false, usedPrefix: prefix };
	}

	return null;
};

/** Argumente, die etwas loeschen oder zuruecksetzen; Commands mit Flag "confirm" fragen dann nach */
const DESTRUCTIVE_ARGS = new Set(['reset', 'delete', 'remove', 'removephrase', 'clear', 'wipe', 'purge']);

/** Erkennt destruktive Aufrufe; das abschliessende "yes" wird entfernt, bevor der Command es sieht */
const checkConfirmation = (args) => {
	const destructive = args.some((i) => DESTRUCTIVE_ARGS.has(i.toLowerCase()));
	const confirmed = destructive && args.length > 0 && args.at(-1)?.toLowerCase() === 'yes';
	return { destructive, confirmed, args: confirmed ? args.slice(0, -1) : [...args] };
};

/** Fehlt ein Pflichtargument (<...> in der Usage, ohne Alternativen mit |), kommt die Usage als Antwort */
const isMissingRequiredArgument = (usage, args) => args.length === 0 && Boolean(usage) && /<[^>]+>/.test(usage) && !usage.includes('|');

/**
 * "!" in einem Channel des utility-bots: kennt der utility-bot den Command, antwortet er, der Bot bleibt still
 */
const isAltPrefixOwnedElsewhere = (parsed, channelName, utilityChannels, utilityKnows = () => true) =>
	parsed.usedPrefix === ALT_PREFIX && channelName !== null && utilityChannels.includes(channelName.toLowerCase()) && utilityKnows(parsed.invocation);

module.exports = { ALT_PREFIX, prefixProblem, parseInvocation, DESTRUCTIVE_ARGS, checkConfirmation, isMissingRequiredArgument, isAltPrefixOwnedElsewhere };
