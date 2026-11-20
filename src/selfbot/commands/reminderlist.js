/**
 * Listet alle offenen Reminder fuer den Aufrufer (aus sb-v2, Supibot hat dafuer nur eine Website-Seite).
 * ninou2, 23.10.2026: "is there a way to check all my reminders on the bot, like supibot have this:
 * https://supinic.com/bot/reminder/list" / "the command should be !reminderlist aka !rl" -
 * "rl" ist schon !randomline, daher "reminders".
 */
module.exports = {
	name: 'reminderlist',
	aliases: ['reminders'],
	cooldown: 5000,
	description: 'Gives a link to your pending reminders, where you can see and remove them.',
	usage: 'reminderlist',
	flags: ['mention'],
	execute: async (client, msg) => {
		const incoming = bot.Reminders.data.get(msg.sender.id) ?? [];
		const outgoing = [...bot.Reminders.data.values()].flat().filter((i) => i.User_From === msg.sender.id && i.User_To !== msg.sender.id);

		const count = incoming.length + outgoing.length;
		if (count === 0) {
			return { text: 'You have no pending reminders.' };
		}

		// ninou2, 03.11.2026: eigene Seite mit Entfernen-Knopf statt Liste im Chat
		return {
			text: `you have ${count} pending reminder${count === 1 ? '' : 's'}, see and remove them here: https://auth.alexmoderat.eu/dashboard#reminders`,
		};
	},
	dynamicDescription: (prefix) => [
		'Links to the page with your pending reminders, where you can remove them.',
		'',
		`<code>${prefix}reminderlist</code>`,
		`<code>${prefix}reminders</code>`,
		`To remove one, use <code>${prefix}unset reminder (ID)</code>.`,
	],
};
