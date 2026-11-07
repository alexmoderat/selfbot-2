const SupiDate = require('../misc/date.js');
const sbv2 = require('../database/sbv2.js');

/**
 * Offene Reminder eines Nutzers fuer die Dashboard-Seite "My reminders" (ninou2, 03.11.2026: "make [it its] own [page] on the
 * website with a button to remove any [you] want"). In Channels des utility-bots laufen sie ueber dessen Tabellen in chat_data,
 * sonst ueber den selfbot. Die Crons beider Bots lesen die Tabellen bei jedem Lauf, ein Loeschen wirkt also sofort.
 */

/**
 * created/dueAt/createdAt fuer die Sortierung auf der Seite (ninou2, 07.11.2026: "there when and where, i suggest to add a 3rd
 * option to sort them date they were created"). dueAt null = "on the next message".
 */

const MAX_REMINDER_TEXT = 400;

const delta = (date) => bot.Utils.timeDelta(date);

const isReminderSource = (value) => value === 'utility-timed' || value === 'utility-next' || value === 'selfbot';

const listSelfbot = async (user) => {
	const own = bot.Reminders.data.get(user.id) ?? [];
	const outgoing = [...bot.Reminders.data.values()].flat().filter((i) => i.User_From === user.id && i.User_To !== user.id);
	const list = [];
	for (const reminder of [...own, ...outgoing]) {
		const incoming = reminder.User_To === user.id;
		const otherId = incoming ? reminder.User_From : reminder.User_To;
		const other = otherId && otherId !== user.id ? (await bot.Users.get(otherId))?.Name : null;
		const channel = reminder.Channel ? bot.Channels.get(reminder.Channel)?.Name : null;
		const who = other ? `${incoming ? 'from' : 'for'} @${other}, ` : '';
		list.push({
			source: 'selfbot',
			id: reminder.ID,
			text: reminder.Text ?? '(ping)',
			when: reminder.Schedule ? delta(reminder.Schedule) : 'on the next message',
			where: `${who}${channel ? `#${channel}` : 'private'}`,
			created: delta(reminder.Created),
			createdAt: reminder.Created.valueOf(),
			dueAt: reminder.Schedule ? reminder.Schedule.valueOf() : null,
			editable: reminder.User_From === user.id && reminder.Text !== null,
		});
	}

	return list;
};

const createdFields = (value) => {
	const date = new SupiDate(value);
	return { created: delta(date), createdAt: date.valueOf() };
};

const listReminders = async (user) => {
	// Reminder des utility-bots liegen in dessen Tabellen (chat_data, geteilte sb-v2-Daten)
	const name = user.name.toLowerCase();
	const [timed, next, own] = await Promise.all([
		sbv2.query('SELECT id, channel, message, due_at, created_at FROM chat_data.reminders WHERE LOWER(username) = ? ORDER BY due_at', [name]),
		sbv2.query('SELECT id, channel, message, set_by, created_at FROM chat_data.user_reminders WHERE LOWER(target_user) = ? ORDER BY created_at', [name]),
		listSelfbot(user),
	]);
	// ninou2, 07.11.2026: "the list should include all reminders a user set" -- auch die fuer andere gesetzten
	const setForOthers = await sbv2.query(
		'SELECT id, channel, message, target_user, created_at FROM chat_data.user_reminders WHERE LOWER(set_by) = ? AND LOWER(target_user) <> ? ORDER BY created_at',
		[name, name],
	);

	return [
		...timed.map((i) => ({
			source: 'utility-timed',
			id: Number(i.id),
			text: i.message,
			when: delta(new SupiDate(i.due_at)),
			where: `#${i.channel}`,
			...createdFields(i.created_at),
			dueAt: new SupiDate(i.due_at).valueOf(),
			editable: true,
		})),
		...next.map((i) => ({
			source: 'utility-next',
			id: Number(i.id),
			text: i.message,
			when: 'on the next message',
			where: `from @${i.set_by}, #${i.channel}`,
			...createdFields(i.created_at),
			dueAt: null,
			editable: i.set_by.toLowerCase() === user.name.toLowerCase(),
		})),
		...setForOthers.map((i) => ({
			source: 'utility-next',
			id: Number(i.id),
			text: i.message,
			when: 'on their next message',
			where: `for @${i.target_user}, #${i.channel}`,
			...createdFields(i.created_at),
			dueAt: null,
			editable: true,
		})),
		...own,
	];
};

/** Nur eigene Reminder: die WHERE-Klausel bzw. der Vergleich prueft den Besitzer, fremde IDs tun nichts */
const removeReminder = async (user, source, id) => {
	const name = user.name.toLowerCase();
	if (source === 'utility-timed') {
		await sbv2.query('DELETE FROM chat_data.reminders WHERE id = ? AND LOWER(username) = ?', [Number(id), name]);
	} else if (source === 'utility-next') {
		await sbv2.query('DELETE FROM chat_data.user_reminders WHERE id = ? AND (LOWER(target_user) = ? OR LOWER(set_by) = ?)', [Number(id), name, name]);
	} else {
		const reminder = bot.Reminders.get(id);
		if (reminder && (reminder.User_To === user.id || reminder.User_From === user.id)) {
			await reminder.deactivate(true, true);
		}
	}
};

/** Text eines selbst geschriebenen Reminders aendern; false = nicht gefunden oder nicht der eigene */
const editReminder = async (user, source, id, text) => {
	const name = user.name.toLowerCase();
	if (source === 'utility-timed') {
		const result = await sbv2.query('UPDATE chat_data.reminders SET message = ? WHERE id = ? AND LOWER(username) = ?', [text, Number(id), name]);
		return (result.affectedRows ?? 0) > 0;
	} else if (source === 'utility-next') {
		const result = await sbv2.query('UPDATE chat_data.user_reminders SET message = ? WHERE id = ? AND LOWER(set_by) = ?', [text, Number(id), name]);
		return (result.affectedRows ?? 0) > 0;
	}

	const reminder = bot.Reminders.get(id);
	if (!reminder || reminder.User_From !== user.id || reminder.Text === null) {
		return false;
	}

	await reminder.setText(text);
	return true;
};

module.exports = { MAX_REMINDER_TEXT, isReminderSource, listReminders, removeReminder, editReminder };
