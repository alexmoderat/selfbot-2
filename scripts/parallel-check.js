// Nachweis im Parallelbetrieb: schickt Testzeilen als Bot-Konto in den Test-Channel (Helix chat/messages) und prueft
// die Antworten, die ein anonymer IRC-Leser sieht. Der Bot muss mit eigenem Prefix und eigener Datenbank laufen
// (config.json: onlyChannels = [Test-Channel], parallelMode false, CHAT_LOG=1 fuer die Modul-Pruefung).
//
//   node --env-file=<env mit TWITCH_USER_TOKEN, TWITCH_USER_CLIENT_ID> scripts/parallel-check.js [--log <bot.log>]
//
// Der Bot-Account ist hier Sender und Antwortender zugleich (Twitch liefert eigene API-Nachrichten per IRC zurueck).
// Der Admin-Fall (Filter-Ausnahme) und der Nicht-Admin-Fall sind getrennt, siehe docs/dont-konzept.md, Abschnitt 6.

const { readFileSync } = require('node:fs');
const path = require('node:path');
const { ChatClient } = require('@kararty/dank-twitch-irc');

const config = JSON.parse(readFileSync(path.join(__dirname, '..', 'config.json'), 'utf8'));
const channel = config.onlyChannels[0];
const prefix = config.prefix;
const logFile = process.argv.includes('--log') ? process.argv[process.argv.indexOf('--log') + 1] : null;

const headers = { Authorization: `Bearer ${process.env.TWITCH_USER_TOKEN}`, 'Client-Id': process.env.TWITCH_USER_CLIENT_ID, 'Content-Type': 'application/json' };
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

const seen = [];
const reader = new ChatClient();
reader.on('PRIVMSG', (message) => {
	if (message.senderUsername === config.selfName.toLowerCase()) {
		seen.push(message.messageText);
	}
});

const send = async (broadcasterId, text) => {
	const response = await fetch('https://api.twitch.tv/helix/chat/messages', {
		method: 'POST',
		headers,
		body: JSON.stringify({ broadcaster_id: broadcasterId, sender_id: config.selfId, message: text }),
	});
	const body = await response.json();
	if (!body.data?.[0]?.is_sent) {
		throw new Error(`Senden fehlgeschlagen: ${response.status} ${body.data?.[0]?.drop_reason?.message ?? ''}`);
	}
};

// Jeder Fall: Zeile, erwartete Antwort (RegExp) - in der Reihenfolge der Ausfuehrung
const CASES = [
	{ name: 'ping (unser Command)', line: `${prefix} ping`, expect: /uptime: .*channels: \d+/ },
	{ name: 'level (Donts Command ueber Donts Handler, Level aus unseren Daten)', line: `${prefix} level`, expect: /is level 3 \(Dev\)/ },
	{ name: 'afk', line: `${prefix} afk checking`, expect: /is now AFK: checking/ },
	{ name: 'remind', line: `${prefix} remind ${config.selfName} parallel check in 31s`, expect: /remind|Reminder set|will be reminded|in 31 seconds/i },
	{ name: 'ask', line: `${prefix} ask what is 2+2`, expect: /AI isn't set up yet|4/ },
	{ name: 'Admin ist vom Filter ausgenommen', line: `${prefix} coinflip`, expect: /Heads|Tails/ },
];

(async () => {
	reader.connect();
	reader.join(channel);
	const users = await (await fetch(`https://api.twitch.tv/helix/users?login=${channel}`, { headers })).json();
	const broadcasterId = users.data[0].id;
	await sleep(3000);

	const results = [];
	const run = async (name, line, expect, wait = 5000) => {
		const before = seen.length;
		await send(broadcasterId, line);
		await sleep(wait);
		const replies = seen.slice(before).filter((text) => text !== line);
		const ok = expect ? replies.some((text) => expect.test(text)) : true;
		results.push({ name, ok });
		console.log(`${ok ? 'OK  ' : 'FEHLT'} ${name}${ok ? '' : `  (gesehen: ${JSON.stringify(replies).slice(0, 200)})`}`);
	};

	for (const item of CASES) {
		await run(item.name, item.line, item.expect);
	}

	// Dashboard-Login: leitet zu Twitch weiter
	if (config.web?.port) {
		const login = await fetch(`http://127.0.0.1:${config.web.port}/login`, { redirect: 'manual' });
		const ok = login.status === 302 && String(login.headers.get('location')).startsWith('https://id.twitch.tv/');
		results.push({ name: 'Dashboard-Login', ok });
		console.log(`${ok ? 'OK  ' : 'FEHLT'} Dashboard-Login (302 zu Twitch)`);
	}

	// Chat-Modul-Ereignis: chat-console-log (CHAT_LOG=1) schreibt jede Nachricht ins Log
	if (logFile) {
		const marker = `module-marker-${Date.now()}`;
		await send(broadcasterId, marker);
		await sleep(2000);
		const ok = readFileSync(logFile, 'utf8').includes(`[Chat] #${channel} ${config.selfName}: ${marker}`);
		results.push({ name: 'Chat-Modul chat-console-log', ok });
		console.log(`${ok ? 'OK  ' : 'FEHLT'} Chat-Modul chat-console-log (Nachricht im Bot-Log)`);
	}

	// AFK-Rueckkehr: schon die eigene Antwort "is now AFK" kommt als Nachricht des Kontos zurueck und beendet den Status
	const afkEnded = seen.some((text) => /is no longer AFK: checking/.test(text));
	results.push({ name: 'AFK-Rueckkehr', ok: afkEnded });
	console.log(`${afkEnded ? 'OK  ' : 'FEHLT'} AFK-Rueckkehr`);

	// Reminder-Zustellung: der Bot meldet ihn zur Faelligkeit (31 s) selbst
	await sleep(30_000);
	const delivered = seen.some((text) => /reminder from yourself.*parallel check/i.test(text));
	results.push({ name: 'Reminder zugestellt', ok: delivered });
	console.log(`${delivered ? 'OK  ' : 'FEHLT'} Reminder zugestellt`);

	const failed = results.filter((item) => !item.ok);
	console.log(failed.length === 0 ? `\nAlle ${results.length} Faelle gruen` : `\n${failed.length} von ${results.length} Faellen fehlgeschlagen`);
	process.exit(failed.length === 0 ? 0 : 1);
})().catch((error) => {
	console.error('Abbruch:', error.message);
	process.exit(2);
});
