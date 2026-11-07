const { isResultFailure } = require('../clients/modules/commands.js');
const { detectTimezone } = require('../misc/timezones.js');

/**
 * Eigene Zeitzone speichern, damit !time ohne Eingabe funktioniert (ninou2, 03.11.2026: "!UserTimeZoneSet !uts",
 * "!uts set UTC+1", "then when i type !time", "without adding anything"). Anders als !set location nennt das keinen Ort.
 * Feste Versaetze wechseln nicht mit der Sommerzeit: CET bleibt UTC+1.
 */
const REMOVE_WORDS = new Set(['unset', 'delete', 'remove']);

module.exports = {
	name: 'usertimezoneset',
	aliases: ['uts'],
	cooldown: 3000,
	description:
		'Saves your timezone, so that the time command works without adding anything. "set UTC+1" or "set CET" saves it, "unset" removes it, nothing shows the current one.',
	usage: 'usertimezoneset [set <timezone> | unset]',
	flags: ['mention'],
	execute: async (client, msg) => {
		const [action, ...rest] = msg.args;
		const low = action?.toLowerCase();
		const saved = await bot.Users.getData(msg.sender, 'timezone');
		if (!low) {
			return { text: saved ? `Your timezone is set to ${saved}.` : `You have not set a timezone yet. Example: ${msg.prefix}uts set UTC+1` };
		} else if (REMOVE_WORDS.has(low)) {
			if (!saved) {
				return { success: false, text: 'You have not set a timezone yet.' };
			}

			await bot.Users.setData(msg.sender, 'timezone', null);
			return { text: 'Your timezone has been removed.' };
		}

		const input = (low === 'set' ? rest : [action, ...rest]).join(' ').trim();
		const zone = input ? detectTimezone(input) : null;
		if (!zone) {
			return { success: false, text: `That's not a timezone I know. Example: ${msg.prefix}uts set UTC+1 or ${msg.prefix}uts set CET` };
		} else if (isResultFailure(zone)) {
			return zone;
		}

		const value = input.toUpperCase();
		await bot.Users.setData(msg.sender, 'timezone', value);
		return { text: `Your timezone is now ${value}, it's ${zone.date} for you right now.` };
	},
};
