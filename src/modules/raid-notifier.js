const { defineChatModule } = require('../clients/modules/chat-modules.js');

const customCommands = require('../services/custom-commands.js');
const { cleanTimes } = require('../services/tweet-notify.js');
const { logCommandExecution } = require('../services/log.js');

/**
 * Raid-Event-Ankuendigung (Bot-Konto 883453487, "A Raid Event at Level") -> alle per subraid angemeldeten User
 * anpingen, 20 s vor Start nochmal (ninou2, 14.10.2026; "Nails" woertlich, alexmoderat 23.10.2026), aus sb-v2.
 */
const ANNOUNCER_ID = '883453487';
const RAID_PATTERN = /A Raid Event at Level/i;
const DURATION_PATTERN = /will begin in (\d+) seconds/i;
const BATCH_SIZE = 10; // Twitch mag keine zu langen Mention-Listen
const DEDUP_TTL_MS = 60_000;
const REMINDER_LEAD_S = 20;

let lastRaid = 0;

// Texte je Channel als Custom Command (customcmd add !raidping / !raidreminder), {users} und {seconds} - alexmoderat,
// 25.10.2026: "als richtigen custom cmd", nachdem ninou2 ihren Zusatz zweimal geaendert haben wollte. Ohne den Custom
// Command der Standard aus sb-v2.
const RAID_TEMPLATE_COMMANDS = { ping: '!raidping', reminder: '!raidreminder' };
// Standardtext (ninou2, 14.11.2026): immer mit der eingestellten Zeit am Ende, z.B. bei 120 s "... Type +join to join! 120 seconds! ⚡"
const DEFAULT_RAID_MESSAGE = '{users} ⚡ Raid is happening! Type +join to join! {seconds} seconds! ⚡';
const DEFAULT_RAID_REMINDER = DEFAULT_RAID_MESSAGE;

const formatRaidText = (template, users, seconds) =>
	template.replaceAll(/\{users\}/gi, users.map((u) => `@${u}`).join(' ')).replaceAll(/\{seconds\}/gi, String(seconds));

const raidPingMessages = (users, template, seconds = REMINDER_LEAD_S) => {
	const messages = [];
	for (let i = 0; i < users.length; i += BATCH_SIZE) {
		messages.push(formatRaidText(template, users.slice(i, i + BATCH_SIZE), seconds));
	}
	return messages;
};

const getSubscribers = async () => {
	const rows = (await bot.DB.RaidSubscriber.find({}, { channel: 1, userAlias: 1 }).lean()).map((i) => ({ Channel: i.channel, User_Alias: i.userAlias }));

	const result = new Map();
	for (const row of rows) {
		const user = await bot.Users.get(row.User_Alias);
		if (user) {
			result.set(row.Channel, [...(result.get(row.Channel) ?? []), user.name]);
		}
	}
	return result;
};

// Jede Benachrichtigung (pro Channel) als Aufruf von !raidping / !raidreminder zaehlen, damit die Custom-Commands-Seite die echte Zahl zeigt
// (ninou2, 14.11.2026: "it should tell how many times it has been posted in the chat ... if its set to x2/x3/x4/x5")
let selfAlias = null;
const countPost = async (channel, reminder, text) => {
	try {
		selfAlias ??= (await bot.Users.getOrCreate(bot.Twitch.selfName)).ID;
		logCommandExecution({
			userId: selfAlias,
			command: `custom:${channel.id}:${reminder ? 'raidreminder' : 'raidping'}`,
			channelId: channel.id,
			invocation: reminder ? 'raidreminder' : 'raidping',
			arguments: [],
			executed: new Date(),
			success: true,
			result: text,
			executionTime: null,
		});
	} catch (e) {
		console.warn('[raid-notifier] Zaehlen fehlgeschlagen', e?.message ?? e);
	}
};

// Zeitpunkt der Erinnerung: 0-120 s vor Start (0 = genau beim Start, ninou2 19.11.2026: "is it possible to use 0 as value",
// fuer eine eigene "has started"-Meldung; vorher 5-120)
const MIN_LEAD_S = 0;
const MAX_LEAD_S = 120;
const clampLead = (value) => {
	const n = Number.parseInt(String(value ?? REMINDER_LEAD_S), 10);
	return Number.isNaN(n) ? REMINDER_LEAD_S : Math.min(MAX_LEAD_S, Math.max(MIN_LEAD_S, n));
};
// Raid Notify je Channel (ninou2, 14.11.2026): standardmaessig aus; eine Liste von Benachrichtigungen, jede mit eigenem Schalter,
// Zeitpunkt (0-120 s vor Start), Text (null = Standardtext) und Anzahl (x1-x5). Gespeichert in den Channel-Daten "raidNotify":
// { enabled, items: [{ id, on, seconds, text, times }] }. Der erste Eintrag ist der 120-s-Ping (= bei der Ankuendigung).
const MAX_ITEMS = 10;
const defaultText = () => DEFAULT_RAID_MESSAGE;
const newItem = (id, seconds = REMINDER_LEAD_S) => ({ id, on: true, seconds: clampLead(seconds), text: null, times: 1 });
const normalizeItem = (i) => ({
	id: Number(i.id),
	on: i.on === true,
	seconds: clampLead(i.seconds),
	text: typeof i.text === 'string' && i.text.trim() ? i.text : null,
	times: cleanTimes(i.times),
});

// Zaehler je Zeit (Sekunden) im Channel: { "120": 12, "53": 50 } - bleibt erhalten, auch wenn die Benachrichtigung entfernt und spaeter mit
// derselben Zeit neu angelegt wird (ninou2, 14.11.2026: "the bot will remember the 50 uses for a 53s notification")
const saveConfig = async (channel, enabled, items) => {
	const current = (await Promise.resolve(bot.Channels.getData(channel, 'raidNotify')).catch(() => null)) ?? {};
	const uses = current.uses && typeof current.uses === 'object' ? current.uses : {};
	await bot.Channels.setData(channel, 'raidNotify', { enabled: enabled === true, items, uses });
	return { enabled: enabled === true, items, uses };
};

const bumpUses = async (channel, seconds) => {
	const data = (await Promise.resolve(bot.Channels.getData(channel, 'raidNotify')).catch(() => null)) ?? {};
	const uses = { ...(data.uses ?? {}) };
	uses[String(seconds)] = (uses[String(seconds)] ?? 0) + 1;
	await bot.Channels.setData(channel, 'raidNotify', { ...data, uses });
};

// Alte Einstellung (Ping/Erinnerung als Custom Commands !raidping/!raidreminder + "seconds") einmalig in die Liste uebernehmen
const migrateLegacy = async (channel, data) => {
	const legacy = async (reminder) => {
		const custom = await customCommands.get(channel, reminder ? RAID_TEMPLATE_COMMANDS.reminder : RAID_TEMPLATE_COMMANDS.ping).catch(() => null);
		// ohne eingestellte Anzahl galt fuer ninou2 ein Einzel-Ping zusaetzlich: das entspricht jetzt x2
		const times = custom?.Times ? cleanTimes(custom.Times) : channel.name === 'ninou2' ? 2 : 1;
		return { text: custom?.Response ?? null, times };
	};
	const ping = await legacy(false);
	const reminder = await legacy(true);
	const items = [
		{ id: 1, on: true, seconds: MAX_LEAD_S, ...ping },
		{ id: 2, on: true, seconds: clampLead(data.seconds), ...reminder },
	].map(normalizeItem);
	return saveConfig(channel, true, items);
};

const getConfig = async (channel) => {
	// getData ist synchron, kein Promise (ninou2, 14.11.2026: "bot.Channels.getData(...).catch not a function")
	const data = (await Promise.resolve(bot.Channels.getData(channel, 'raidNotify')).catch(() => null)) ?? {};
	if (Array.isArray(data.items)) {
		return { enabled: data.enabled === true, items: data.items.map(normalizeItem), uses: data.uses ?? {} };
	}
	return data.enabled === true ? migrateLegacy(channel, data) : { enabled: false, items: [], uses: {} };
};

/** Raid Notify unter Bot Commands ein-/ausschalten; beim Einschalten ohne aktive Eintraege entsteht der Standard-Eintrag (120 s) */
const setEnabled = async (channel, want) => {
	const config = await getConfig(channel);
	if (!want) {
		return saveConfig(channel, false, config.items);
	}
	return config.items.some((i) => i.on) ? saveConfig(channel, true, config.items) : saveConfig(channel, true, [newItem(1, MAX_LEAD_S)]);
};

/** Eintraege aendern; sind danach alle aus (oder keiner mehr da), schaltet sich Raid Notify selbst aus */
const updateItems = async (channel, change) => {
	const config = await getConfig(channel);
	const items = change(config.items.slice()).map(normalizeItem);
	return saveConfig(channel, items.some((i) => i.on), items);
};

const pingChannel = async (channel, users, item) => {
	const template = item.text ?? defaultText(item.seconds);
	const reminder = item.seconds < MAX_LEAD_S;
	const texts = raidPingMessages(users, template, item.seconds);
	for (const text of texts) {
		for (let i = 0; i < item.times; i++) {
			await bot.Channels.send(channel, text).catch(() => {});
		}
	}
	// Eine Benachrichtigung zaehlt einmal, egal wie oft sie wegen der Einstellung (x2-x5) oder wegen mehrerer Namenslisten
	// gepostet wird (ninou2, 14.11.2026: "even if a person set it to x5, the 120s noti count as 1 post, and the 20s noti count as 1")
	if (texts.length > 0) {
		await countPost(channel, reminder, texts[0]);
		await bumpUses(channel, item.seconds).catch((e) => console.warn('[raid-notifier] Zaehler', e?.message ?? e));
	}
	return texts.length;
};

/**
 * Alle Benachrichtigungen aller Channels mit eingeschaltetem Raid Notify: jede zu "Dauer minus ihre Sekunden" nach der Ankuendigung,
 * die mit seconds >= Dauer sofort (Reihenfolge: groesste Zeit zuerst). Unbekannte Dauer (0): nur die 120-s-Eintraege.
 */
const runRaid = async (subscribers, duration) => {
	let batches = 0;
	for (const [channelId, users] of subscribers) {
		const channel = bot.Channels.get(channelId);
		if (!channel || channel.mode === 'Inactive') {
			continue;
		}
		const config = await getConfig(channel);
		if (!config.enabled) {
			continue;
		}
		const items = config.items.filter((i) => i.on).sort((a, b) => b.seconds - a.seconds);
		for (const item of items) {
			if (item.seconds >= (duration || MAX_LEAD_S)) {
				batches += await pingChannel(channel, users, item);
			} else if (duration > 0) {
				setTimeout(
					() => {
						void pingChannel(channel, users, item).catch((e) => console.warn('[raid-notifier] Erinnerung', e));
					},
					(duration - item.seconds) * 1000,
				);
			}
		}
	}
	return batches;
};

const lastTest = new Map();
const TEST_COOLDOWN_MS = 30_000;
const TEST_GAP_MS = 1_200;

/**
 * Probelauf aus dem Dashboard (ninou2, 14.11.2026: "is there a way to send a raid notification as a test"): alle eingeschalteten
 * Benachrichtigungen einmal sofort in den eigenen Channel, nur der Testende wird erwaehnt (nicht die !subraid-Liste), Anzahl (x2-x5)
 * wie eingestellt, ohne den Zaehler zu erhoehen. Mindestens 30 s Pause je Channel, Abstand zwischen den Nachrichten.
 */
const sendTest = async (channel, username) => {
	const wait = (lastTest.get(channel.id) ?? 0) + TEST_COOLDOWN_MS - Date.now();
	if (wait > 0) {
		return { error: `Please wait ${Math.ceil(wait / 1000)}s before the next test.` };
	}
	const config = await getConfig(channel);
	const items = config.items.filter((i) => i.on).sort((a, b) => b.seconds - a.seconds);
	if (items.length === 0) {
		return { error: 'No active raid notification to test.' };
	}
	lastTest.set(channel.id, Date.now());
	let sent = 0;
	for (const item of items) {
		const [text] = raidPingMessages([username], item.text ?? defaultText(item.seconds), item.seconds);
		for (let i = 0; i < item.times; i++) {
			if (sent > 0) {
				await new Promise((resolve) => setTimeout(resolve, TEST_GAP_MS));
			}
			await bot.Channels.send(channel, text).catch(() => {});
			sent++;
		}
	}
	return { sent };
};

module.exports = defineChatModule({
	name: 'raid-notifier',
	description: 'Pings subraid subscribers when a raid event starts, and again 20 s before it begins.',
	scope: 'global',
	handlers: {
		message: async (context) => {
			const { user, message, channel } = context;
			if (user.twitchId !== ANNOUNCER_ID || !RAID_PATTERN.test(message)) {
				return;
			}
			if (Date.now() - lastRaid < DEDUP_TTL_MS) {
				return;
			}
			lastRaid = Date.now();

			const subscribers = await getSubscribers();
			if (subscribers.size === 0) {
				return;
			}

			const duration = Number(DURATION_PATTERN.exec(message)?.[1] ?? 0);
			const batches = await runRaid(subscribers, duration);
			console.log(`[raid-notifier] Raid in #${channel.name} - ${batches} sofortige Nachricht(en), ${subscribers.size} Channel(s)`);
		},
	},
});

Object.assign(module.exports, { sendTest, bumpUses, runRaid, MIN_LEAD_S, MAX_LEAD_S, MAX_ITEMS, clampLead, getConfig, setEnabled, updateItems, newItem, defaultText, RAID_TEMPLATE_COMMANDS, DEFAULT_RAID_MESSAGE, DEFAULT_RAID_REMINDER, formatRaidText, raidPingMessages });
