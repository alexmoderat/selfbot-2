const { getCommand } = require('../clients/modules/commands.js');

/**
 * Befehle direkt auf der Website ausfuehren (ninou2, 03.11.2026: "create like a tab on the website", "as if someone was
 * trying to tigger the [command] from a chat"). Stufe 1 ohne Login: feste Freigabeliste reiner Abfragen, die vom Context
 * nur Channel-Namen, Anzeigename und Prefix lesen. Antworten bleiben auf der Seite, in keinen Chat wird geschrieben.
 */
const PUBLIC_RUN_COMMANDS = new Set([
	'hoursstreamed',
	'hoursstreamedhistory',
	'daysstreamed',
	'streamerstreak',
	'streamerstreakhistory',
	'hoursstreamedcategories',
	'hoursstreamedcategorieshistory',
	'checkhoursstreamedcategory',
	'getdata',
	'lastlive',
]);

const WEB_DISPLAY_NAME = 'web';
const MAX_INPUT_LENGTH = 200;
const MAX_RUNS_PER_MINUTE = 30;
const LOGIN_PATTERN = /^[a-z0-9_]{1,25}$/;

const minuteRuns = new Map();
const lastRun = new Map();

const resetRunLimits = () => {
	minuteRuns.clear();
	lastRun.clear();
};

const parseInput = (input) => {
	const [identifier, ...args] = input
		.trim()
		.replace(/^(?:!|sb\s+)/i, '')
		.split(/\s+/);
	return { identifier: (identifier ?? '').toLowerCase(), args };
};

/** Gemeinsames Limit pro IP, dazu dieselbe Abklingzeit pro Befehl wie im Chat. Liefert die Wartezeit in Sekunden. */
const checkRunLimits = (ip, command, now) => {
	const recent = (minuteRuns.get(ip) ?? []).filter((i) => now - i < 60_000);
	const commandKey = `${ip}:${command.Name}`;
	const cooldownEnd = (lastRun.get(commandKey) ?? 0) + command.Cooldown;
	if (recent.length >= MAX_RUNS_PER_MINUTE) {
		return Math.ceil((recent[0] + 60_000 - now) / 1000);
	} else if (cooldownEnd > now) {
		return Math.ceil((cooldownEnd - now) / 1000);
	}

	minuteRuns.set(ip, [...recent, now]);
	lastRun.set(commandKey, now);
	return 0;
};

const runPublicCommand = async (data) => {
	const channel = String(data.channel ?? '')
		.trim()
		.replace(/^[@#]+/, '')
		.toLowerCase();
	const input = String(data.input ?? '');
	if (!LOGIN_PATTERN.test(channel)) {
		return { status: 400, error: 'Enter a valid channel name.' };
	} else if (!input.trim() || input.length > MAX_INPUT_LENGTH) {
		return { status: 400, error: `Enter a command (up to ${MAX_INPUT_LENGTH} characters).` };
	}

	const { identifier, args } = parseInput(input);
	const command = getCommand(identifier);
	if (!command || !PUBLIC_RUN_COMMANDS.has(command.Name)) {
		return { status: 403, error: `"${identifier}" can't be used on the website yet.` };
	}

	const retryAfter = checkRunLimits(data.ip, command, data.now ?? Date.now());
	if (retryAfter > 0) {
		return { status: 429, error: `Slow down, try again in ${retryAfter}s.`, retryAfter };
	}

	// Nachbau einer Chatnachricht: nur Channelname, kein Absender (die freigegebenen Commands brauchen nicht mehr)
	const replies = [];
	const msg = {
		displayName: WEB_DISPLAY_NAME,
		channelData: { name: channel, Name: channel },
		sender: null,
		prefix: '!',
		invocation: identifier,
		args,
		params: {},
		send: async (text) => {
			replies.push(text);
		},
		getBestAvailableEmote: async (emotes, fallback) => fallback,
	};

	const result = await command.execute(bot.Client, msg);
	if (result?.text) {
		replies.push(result.text);
	}

	return { status: 200, replies: replies.map((i) => i.replace(new RegExp(`^@${WEB_DISPLAY_NAME},\\s*`), '')) };
};

module.exports = { PUBLIC_RUN_COMMANDS, resetRunLimits, checkRunLimits, runPublicCommand };
