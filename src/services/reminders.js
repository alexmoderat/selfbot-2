const { getConfig } = require('../config.js');
const { timeDelta, splitByCondition, partitionString, tag } = require('../misc/utility.js');
const { LongTimeout } = require('../misc/long-timeout.js');
const { uploadToOwnHaste } = require('../misc/haste.js');
const { Logger } = require('../misc/logger.js');
const Filter = require('./filter.js');
const Users = require('./users.js');
const AFK = require('./afk.js');

// Supibots Reminder (bisher classes/reminder.ts). Typen:
// - "Reminder": erinnert das Ziel bei der naechsten Nachricht oder zu einem Zeitpunkt
// - "Pingme": meldet dem Absender, wenn das Ziel schreibt
// - "Deferred": erinnert das Ziel bei der naechsten Nachricht nach einem Zeitpunkt

/** Hoeheres Limit fuer aktive Reminder einzelner User (ninou2, 07.11.2026: "i get my list max to 20") */
const ACTIVE_LIMIT_OVERRIDES = new Map([[4293, 20]]); // ninou2
const activeLimitFor = (userId, fallback) => Math.max(fallback, ACTIVE_LIMIT_OVERRIDES.get(userId) ?? 0);

const REMINDER_ERROR_REASONS = {
	'scheduled-incoming': 'That person has too many timed reminders pending for them on that day!',
	'scheduled-outgoing': 'You have too many timed reminders pending on that day!',
	'public-incoming': 'That person has too many public reminders pending!',
	'public-outgoing': 'You have too many public reminders pending!',
	'private-incoming': 'That person has too many private reminders pending!',
	'private-outgoing': 'You have too many private reminders pending!',
	'existing-pingme': 'You have too many private reminders pending!',
};

const data = new Map(); // userTo -> Reminder[]
const available = new Map(); // reminderId -> userTo

const mention = (user) => `@${user.name}`;

const fromDoc = (doc) => ({
	id: doc._id,
	userFrom: doc.userFrom ?? null,
	userTo: doc.userTo,
	channelId: doc.channelId ?? null,
	text: doc.text ?? null,
	created: new Date(doc.created),
	schedule: doc.schedule ? new Date(doc.schedule) : null,
	privateMessage: Boolean(doc.privateMessage),
	type: doc.type ?? 'Reminder',
	timeout: null,
	deactivated: false,
});

const destroy = (reminder) => {
	reminder.timeout?.clear();
	reminder.timeout = null;
};

/** Zeit-Reminder: zum Zeitpunkt in den Channel bzw. per Whisper */
const fireScheduled = async (reminder) => {
	const channel = reminder.channelId === null ? null : bot.Channels.get(reminder.channelId);
	const toUser = await Users.get(reminder.userTo);
	if (!toUser) {
		throw new Error(`Reminder ${reminder.id} has no valid target user`);
	}
	const fromUser = reminder.userFrom === reminder.userTo ? toUser : reminder.userFrom ? await Users.get(reminder.userFrom) : null;

	const delta = timeDelta(reminder.created);
	let message;
	if (reminder.userFrom === reminder.userTo) {
		message = `${mention(toUser)}, reminder from yourself (${delta}): ${reminder.text}`;
	} else if (!fromUser) {
		message = `${mention(toUser)}, system reminder (${delta}): ${reminder.text}`;
	} else {
		message = `${mention(toUser)}, timed reminder from ${mention(fromUser)} (${delta}): ${reminder.text}`;
	}

	if (AFK.get(toUser) && channel) {
		await create(
			{
				userFrom: null,
				userTo: toUser.id,
				channelId: channel.id,
				schedule: null,
				type: 'Reminder',
				text: `You got a scheduled reminder (ID ${reminder.id}) while you were AFK: ${message}`,
				privateMessage: true,
			},
			true,
		);
	}

	if (reminder.privateMessage) {
		await bot.Twitch.whisper(toUser, message);
	} else if (!channel) {
		throw new Error(`Cannot post non-private reminder ${reminder.id} in an unspecified channel`);
	} else {
		await bot.Channels.send(channel, message);
	}

	await deactivate(reminder, true, false);
};

const activateTimeout = (reminder) => {
	if (!reminder.schedule || reminder.type === 'Deferred' || reminder.type === 'Pingme') {
		return;
	}
	// Parallelbetrieb: Zeit-Reminder feuert der alte selfbot
	if (bot.Config.parallelMode) {
		return;
	}
	if (Date.now() > reminder.schedule.valueOf()) {
		void deactivate(reminder, true, false);
		return;
	}
	if (typeof reminder.text !== 'string') {
		throw new Error(`Scheduled reminder ${reminder.id} has no text`);
	}

	reminder.timeout = new LongTimeout(
		() => fireScheduled(reminder).catch((e) => Logger.warn('[reminder] Zeit-Reminder fehlgeschlagen', { id: reminder.id, e: e.message })),
		reminder.schedule.valueOf(),
		true,
	);
};

const add = (reminder) => {
	let list = data.get(reminder.userTo);
	if (!list) {
		list = [];
		data.set(reminder.userTo, list);
	}
	available.set(reminder.id, reminder.userTo);
	list.push(reminder);
	activateTimeout(reminder);
};

/** permanent: in reminderHistory verschieben; cancelled: dort als abgebrochen markieren */
const remove = async (id, { cancelled = false, permanent = false } = {}) => {
	if (permanent) {
		const doc = await bot.DB.Reminder.findById(id).lean();
		if (doc) {
			await bot.DB.ReminderHistory.updateOne({ _id: id }, { $set: { ...doc, cancelled: Boolean(cancelled) } }, { upsert: true });
			await bot.DB.Reminder.deleteOne({ _id: id });
		}
	}

	const userTo = available.get(id);
	if (userTo === undefined) {
		return false;
	}
	const list = data.get(userTo);
	const index = list?.findIndex((i) => i.id === id) ?? -1;
	if (!list || index === -1) {
		return false;
	}
	destroy(list[index]);
	list.splice(index, 1);
	available.delete(id);
	return true;
};

const deactivate = async (reminder, permanent, cancelled) => {
	reminder.timeout?.clear();
	await remove(reminder.id, { cancelled, permanent });
	return reminder;
};

const clear = () => {
	for (const list of data.values()) {
		list.forEach(destroy);
	}
	available.clear();
	data.clear();
};

const load = async () => {
	clear();
	const threshold = Date.now() + 10 * 365 * 86_400_000;
	for (const doc of await bot.DB.Reminder.find({}).lean()) {
		// Zeit-Reminder mehr als 10 Jahre in der Zukunft nicht laden
		if (doc.schedule && new Date(doc.schedule).valueOf() > threshold) {
			continue;
		}
		add(fromDoc(doc));
	}
	return available.size;
};

const get = (id) => {
	const userTo = available.get(id);
	return userTo === undefined ? null : (data.get(userTo)?.find((i) => i.id === id) ?? null);
};

const startOfUtcDay = (date) => new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()));

/** Prueft die Limits fuer einen neuen Reminder */
const checkLimits = async (userFrom, userTo, schedule, type = 'Reminder') => {
	const { maxIncomingActiveReminders, maxOutgoingActiveReminders, maxIncomingScheduledReminders, maxOutgoingScheduledReminders } = getConfig().values;
	const activeQuery = {
		$or: [
			{ type: 'Reminder', schedule: null },
			{ type: 'Deferred', schedule: { $ne: null } },
		],
	};

	const [incoming, outgoing] = await Promise.all([
		bot.DB.Reminder.find({ ...activeQuery, userFrom: { $ne: null }, userTo }, { privateMessage: 1 }).lean(),
		bot.DB.Reminder.find({ ...activeQuery, schedule: null, userFrom }, { privateMessage: 1 }).lean(),
	]);
	const [privateIncoming, publicIncoming] = splitByCondition(incoming, (i) => Boolean(i.privateMessage));
	const [privateOutgoing, publicOutgoing] = splitByCondition(outgoing, (i) => Boolean(i.privateMessage));

	const fail = (cause) => ({ success: false, cause, reason: REMINDER_ERROR_REASONS[cause] });
	const incomingLimit = activeLimitFor(userTo, maxIncomingActiveReminders);
	const outgoingLimit = activeLimitFor(userFrom, maxOutgoingActiveReminders);
	if (publicIncoming.length >= incomingLimit) return fail('public-incoming');
	if (publicOutgoing.length >= outgoingLimit) return fail('public-outgoing');
	if (privateIncoming.length >= incomingLimit) return fail('private-incoming');
	if (privateOutgoing.length >= outgoingLimit) return fail('private-outgoing');

	if (schedule) {
		const dayStart = startOfUtcDay(schedule);
		const dayEnd = new Date(dayStart.valueOf() + 86_400_000);
		const sameDay = { schedule: { $gte: dayStart, $lt: dayEnd }, type: { $ne: 'Deferred' } };
		const [scheduledIncoming, scheduledOutgoing] = await Promise.all([
			bot.DB.Reminder.countDocuments({ ...sameDay, userTo }),
			bot.DB.Reminder.countDocuments({ ...sameDay, userFrom }),
		]);
		if (scheduledIncoming >= maxIncomingScheduledReminders) return fail('scheduled-incoming');
		if (scheduledOutgoing >= maxOutgoingScheduledReminders) return fail('scheduled-outgoing');
	}

	if (type === 'Pingme' && (await bot.DB.Reminder.exists({ type: 'Pingme', userFrom, userTo }))) {
		return fail('existing-pingme');
	}

	return { success: true };
};

/** Neuer Reminder; @returns {{ success: true, id } | { success: false, cause, reason }} */
async function create(input, skipChecks = false) {
	if (!skipChecks && input.userFrom !== null) {
		const limits = await checkLimits(input.userFrom, input.userTo, input.schedule ?? null, input.type);
		if (!limits.success) {
			return limits;
		}
	}

	const doc = await bot.DB.Reminder.create({
		_id: await bot.DB.nextId('reminders'),
		userFrom: input.userFrom,
		userTo: input.userTo,
		channelId: input.channelId ?? null,
		text: input.text ?? null,
		created: new Date(),
		schedule: input.schedule ?? null,
		privateMessage: Boolean(input.privateMessage),
		type: input.type ?? 'Reminder',
	});
	add(fromDoc(doc.toObject()));
	return { success: true, cause: null, id: doc._id };
}

/** Text nachtraeglich aendern (Dashboard "My reminders") */
const setText = async (reminder, text) => {
	await bot.DB.Reminder.updateOne({ _id: reminder.id }, { $set: { text } });
	reminder.text = text;
};

/** Ersatz fuer Supibots Website-Relay: Haste-Seite mit den Reminder-Texten */
const createListLink = async (targetUser, reminders) => {
	const lines = [];
	for (const reminder of reminders) {
		const from = reminder.userFrom ? await Users.get(reminder.userFrom) : null;
		const author = reminder.userFrom === targetUser.id ? 'yourself' : (from?.name ?? 'system');
		lines.push(`ID ${reminder.id} - from ${author} (${timeDelta(reminder.created)}): ${reminder.text ?? ''}`);
	}
	try {
		return await uploadToOwnHaste(`Reminders for ${targetUser.name}\n\n${lines.join('\n')}`);
	} catch {
		return '(link unavailable)';
	}
};

/** Feuert alle Reminder, die auf die naechste Nachricht des Users warten - bei jeder Chatnachricht */
const checkActive = async (targetUser, channel, displayName = targetUser.name) => {
	const list = data.get(targetUser.id);
	if (!list || list.length === 0) {
		return;
	}

	// ban type:reminder-prevention: Reminder dieser Absender feuern in diesem Channel nicht
	const excluded = Filter.getReminderPreventions({ channel });
	const now = Date.now();
	const reminders = list.filter(
		(i) =>
			!i.deactivated &&
			((i.type === 'Deferred' && i.schedule && i.schedule.valueOf() <= now) || (i.type !== 'Deferred' && !i.schedule)) &&
			!excluded.includes(i.userFrom),
	);
	if (reminders.length === 0) {
		return;
	}

	// Sofort im Speicher deaktivieren, damit viele gleichzeitige Nachrichten nicht doppelt senden
	reminders.forEach((i) => {
		i.deactivated = true;
	});

	const reply = [];
	const privateReply = [];
	for (const reminder of reminders) {
		const fromUser = reminder.userFrom ? await Users.get(reminder.userFrom) : null;
		if (reminder.type === 'Pingme') {
			if (!fromUser) {
				Logger.warn('[reminder] Pingme ohne gueltigen Absender', reminder.id);
				continue;
			}
			const reminderChannel = reminder.channelId ? bot.Channels.get(reminder.channelId) : null;
			let message = `${mention(fromUser)}, ${mention(targetUser)} just typed in channel ${channel.name}`;
			if (reminder.text) {
				message += `: ${reminder.text}`;
			}
			if (reminder.privateMessage) {
				await bot.Twitch.whisper(fromUser, message);
			} else if (reminderChannel) {
				await bot.Channels.send(reminderChannel, message);
			}
			continue;
		}

		const delta = timeDelta(reminder.created);
		let reminderMessage;
		if (reminder.userFrom === targetUser.id) {
			reminderMessage = `yourself - ${reminder.text} (${delta})`;
		} else if (!fromUser) {
			reminderMessage = `system reminder - ${reminder.text} (${delta})`;
		} else {
			reminderMessage = `${mention(fromUser)} - ${reminder.text} (${delta})`;
		}
		(reminder.privateMessage ? privateReply : reply).push(reminderMessage);
	}

	const userMention = `@${displayName},`;
	if (reply.length !== 0) {
		let message = `${userMention} reminder(s) from: ${reply.join('; ')}`;
		const limit = bot.Config.messageLimit;
		// Zu lang: Liste der IDs mit Link auf die vollen Texte
		if (message.length > limit) {
			const publicReminders = reminders.filter((i) => !i.privateMessage && i.type !== 'Pingme');
			const link = await createListLink(targetUser, publicReminders);
			message = tag.trim`
				Hey ${userMention}
				you have ${publicReminders.length} reminders, but they're too long to be posted.
				Check them here: ${link}
				or by ID: ${publicReminders.map((i) => i.id).join(' ')}
			`;
		}
		await bot.Channels.send(channel, partitionString(message, limit, 1)[0]);
	}

	if (privateReply.length !== 0) {
		for (const privateReminder of privateReply) {
			await bot.Twitch.whisper(targetUser, `Private reminder: ${privateReminder}`);
		}
		await bot.Channels.send(
			channel,
			`Hey ${userMention} - I just private messaged you ${privateReply.length} private reminder(s) - make sure to check them out!`,
		);
	}

	await Promise.all(reminders.map((reminder) => deactivate(reminder, true, false)));
};

/** Aktive Reminder (fuer Commands und Dashboard) */
const list = () => [...data.values()].flat();

module.exports = {
	REMINDER_ERROR_REASONS,
	activeLimitFor,
	load,
	get,
	list,
	create,
	deactivate,
	setText,
	checkLimits,
	checkActive,
	createListLink,
	_data: data,
};
