const { commands } = require('../clients/modules/commands.js');
const { defineChatModule } = require('../clients/modules/chat-modules.js');

const customCommands = require('../services/custom-commands.js');

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
	const rows = await core.Query.getRecordset((rs) =>
		rs // TODO(port)
			.select('Channel', 'User_Alias')
			.from('selfbot_data', 'Raid_Subscriber'),
	);

	const result = new Map();
	for (const row of rows) {
		const user = await bot.Users.get(row.User_Alias);
		if (user) {
			result.set(row.Channel, [...(result.get(row.Channel) ?? []), user.name]);
		}
	}
	return result;
};

const getTemplate = async (channel, reminder) => {
	const custom = await customCommands.get(channel, reminder ? RAID_TEMPLATE_COMMANDS.reminder : RAID_TEMPLATE_COMMANDS.ping).catch(() => null);
	return custom?.Response ?? (reminder ? DEFAULT_RAID_REMINDER : DEFAULT_RAID_MESSAGE);
};

const pingAll = async (subscribers, reminder) => {
	let batches = 0;
	for (const [channelId, users] of subscribers) {
		const channel = bot.Channels.get(channelId);
		if (!channel || channel.mode === 'Inactive') {
			continue;
		}
		const template = await getTemplate(channel, reminder);
		for (const text of raidPingMessages(users, template)) {
			await bot.Channels.send(channel, text).catch(() => {});
			batches++;
		}
		// ninou2 moechte zweimal gepingt werden (01.08.2026) - bewusst nur dieser eine User
		if (channel.name === 'ninou2' && users.includes('ninou2')) {
			await bot.Channels.send(channel, formatRaidText(template, ['ninou2'], REMINDER_LEAD_S)).catch(() => {});
		}
	}
	return batches;
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

			const batches = await pingAll(subscribers, false);
			console.log(`[raid-notifier] Raid in #${channel.name} - ${batches} Nachricht(en) in ${subscribers.size} Channel(s)`);

			const duration = Number(DURATION_PATTERN.exec(message)?.[1] ?? 0);
			if (duration > REMINDER_LEAD_S) {
				setTimeout(
					() => {
						void pingAll(subscribers, true).catch((e) => console.warn('[raid-notifier] Reminder', e));
					},
					(duration - REMINDER_LEAD_S) * 1000,
				);
			}
		},
	},
});

Object.assign(module.exports, { RAID_TEMPLATE_COMMANDS, DEFAULT_RAID_MESSAGE, DEFAULT_RAID_REMINDER, formatRaidText, raidPingMessages });
