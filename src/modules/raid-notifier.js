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
const REMINDER_TAG = 'Nails';

let lastRaid = 0;

// Texte je Channel als Custom Command (customcmd add !raidping / !raidreminder), {users} und {seconds} - alexmoderat,
// 25.10.2026: "als richtigen custom cmd", nachdem ninou2 ihren Zusatz zweimal geaendert haben wollte. Ohne den Custom
// Command der Standard aus sb-v2.
const RAID_TEMPLATE_COMMANDS = { ping: '!raidping', reminder: '!raidreminder' };
const DEFAULT_RAID_MESSAGE = '{users} ⚡ Raid is happening! Type +join to join!';
const DEFAULT_RAID_REMINDER = `{users} ⚡ Raid is happening! Type +join to join! ( {seconds}s Left ${REMINDER_TAG} )`;

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

// times: wie oft jede Meldung gepostet wird (ninou2, 14.11.2026: "both commands should get the times feature"); null = nie
// eingestellt, dann gilt das alte Verhalten (ein Mal, fuer ninou2 zusaetzlich ihr Einzel-Ping)
const getTemplate = async (channel, reminder) => {
	const custom = await customCommands.get(channel, reminder ? RAID_TEMPLATE_COMMANDS.reminder : RAID_TEMPLATE_COMMANDS.ping).catch(() => null);
	return {
		text: custom?.Response ?? (reminder ? DEFAULT_RAID_REMINDER : DEFAULT_RAID_MESSAGE),
		times: custom?.Times ? cleanTimes(custom.Times) : null,
	};
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

// Raid Notify je Channel (ninou2, 14.11.2026): standardmaessig aus, eigener Zeitpunkt der Erinnerung (5-120 s vor Start)
const MIN_LEAD_S = 5;
const MAX_LEAD_S = 120;
const clampLead = (value) => {
	const n = Number.parseInt(String(value ?? REMINDER_LEAD_S), 10);
	return Number.isNaN(n) ? REMINDER_LEAD_S : Math.min(MAX_LEAD_S, Math.max(MIN_LEAD_S, n));
};
const raidSettings = async (channel) => {
	const data = await bot.Channels.getData(channel, 'raidNotify').catch(() => null);
	return { enabled: data?.enabled === true, seconds: clampLead(data?.seconds) };
};

const pingChannel = async (channel, users, reminder, seconds = REMINDER_LEAD_S) => {
	const { text: template, times } = await getTemplate(channel, reminder);
	const texts = raidPingMessages(users, template, seconds);
	for (const text of texts) {
		for (let i = 0; i < (times ?? 1); i++) {
			await bot.Channels.send(channel, text).catch(() => {});
		}
	}
	// Eine Benachrichtigung zaehlt einmal, egal wie oft sie wegen der Einstellung (x2-x5) oder wegen mehrerer Namenslisten
	// gepostet wird (ninou2, 14.11.2026: "even if a person set it to x5, the 120s noti count as 1 post, and the 20s noti count as 1")
	if (texts.length > 0) {
		await countPost(channel, reminder, texts[0]);
	}
	// ninou2 moechte zweimal gepingt werden (01.08.2026) - bewusst nur dieser eine User; sobald die Anzahl im Dashboard
	// eingestellt ist, gilt diese und der Einzel-Ping entfaellt
	if (times === null && channel.name === 'ninou2' && users.includes('ninou2')) {
		await bot.Channels.send(channel, formatRaidText(template, ['ninou2'], seconds)).catch(() => {});
	}
	return texts.length;
};

/** Erste Meldung (Event angekuendigt) in allen Channels, die Raid Notify eingeschaltet haben */
const pingAll = async (subscribers) => {
	let batches = 0;
	for (const [channelId, users] of subscribers) {
		const channel = bot.Channels.get(channelId);
		if (!channel || channel.mode === 'Inactive' || !(await raidSettings(channel)).enabled) {
			continue;
		}
		batches += await pingChannel(channel, users, false);
	}
	return batches;
};

/** Erinnerung je Channel zu dessen eigenem Zeitpunkt ("seconds" vor Start) */
const scheduleReminders = async (subscribers, duration) => {
	for (const [channelId, users] of subscribers) {
		const channel = bot.Channels.get(channelId);
		if (!channel || channel.mode === 'Inactive') {
			continue;
		}
		const { enabled, seconds } = await raidSettings(channel);
		if (enabled && duration > seconds) {
			setTimeout(
				() => {
					void pingChannel(channel, users, true, seconds).catch((e) => console.warn('[raid-notifier] Reminder', e));
				},
				(duration - seconds) * 1000,
			);
		}
	}
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

			const batches = await pingAll(subscribers);
			console.log(`[raid-notifier] Raid in #${channel.name} - ${batches} Nachricht(en) in ${subscribers.size} Channel(s)`);

			const duration = Number(DURATION_PATTERN.exec(message)?.[1] ?? 0);
			await scheduleReminders(subscribers, duration);
		},
	},
});

Object.assign(module.exports, { MIN_LEAD_S, MAX_LEAD_S, clampLead, RAID_TEMPLATE_COMMANDS, DEFAULT_RAID_MESSAGE, DEFAULT_RAID_REMINDER, formatRaidText, raidPingMessages });
