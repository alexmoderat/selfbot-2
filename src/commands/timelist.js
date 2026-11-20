const { uploadToOwnHaste } = require('../token/haste.js');
const { formatCountryList, formatTimezoneList } = require('../util/timezones.js');

/** Alle Zeitzonen-Abkuerzungen fuer !time und !uts als Link (ninou2, 03.11.2026: "a new command that show [the] zone names", "!timelist", "add by countries too") */
module.exports = {
	name: 'timelist',
	cooldown: 10000,
	description: 'Gives a link to the list of all timezone names and countries you can use with the time and usertimezoneset commands.',
	usage: 'timelist',
	flags: ['mention'],
	execute: async (client, msg) => {
		const zones = formatTimezoneList();
		const countries = formatCountryList();
		const link = await uploadToOwnHaste(
			`Timezones (${zones.length} total)\n${'='.repeat(40)}\n${zones.join('\n')}\n\nCountries (${countries.length} total)\n${'='.repeat(40)}\n${countries.join('\n')}`,
		);
		return { text: `${zones.length} timezones and ${countries.length} countries: ${link} You can also use offsets like UTC+1.` };
	},
};
