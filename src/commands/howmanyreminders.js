const { listReminders, listReminderHistory, reminderPeriodCounts } = require('../api/reminders.js');

// ninou2, 08.11.2026: "this command should tell the reminders number with the normal types ( monthly/year / yearly / all )".
// Zaehlt dieselben Reminder wie das Dashboard: offene und vergangene, aus beiden Bots.
module.exports = {
	name: 'howmanyreminders',
	aliases: ['hmr'],
	cooldown: 5000,
	description: 'Tells you how many reminders you have had: all time, this year and this month.',
	usage: 'howmanyreminders',
	flags: ['mention'],
	execute: async (client, msg) => {
		const [pending, history] = await Promise.all([listReminders(msg.sender), listReminderHistory(msg.sender)]);
		const counts = reminderPeriodCounts([...pending, ...history].map((i) => i.createdAt));
		return {
			text: `your reminders: ${counts.all} all time, ${counts.year} in ${counts.yearLabel}, ${counts.month} in ${counts.monthLabel}.`,
		};
	},
};
