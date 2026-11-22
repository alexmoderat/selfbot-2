const colorCycler = require('../util/color-cycler.js');

/** Account-weiter Schalter: wechselt bei jeder gesendeten Bot-Nachricht die Chat-Namensfarbe (aus sb-v2) */
module.exports = {
	name: 'colorcycle',
	cooldown: 3000,
	description: 'Toggles cycling through chat name colors on every sent message.',
	usage: 'colorcycle <on|off>',
	flags: ['owner'],
	initialize: async () => {
		await colorCycler.initialize();
	},
	execute: async (client, msg) => {
		const [state] = msg.args;
		const display = msg.displayName;
		const value = state?.toLowerCase();
		if (value !== 'on' && value !== 'off') {
			return { text: `@${display}, colorcycle is ${colorCycler.isEnabled() ? 'on' : 'off'}. Usage: ${msg.prefix}${msg.invocation} <on|off>` };
		}

		await colorCycler.setEnabled(value === 'on');
		return {
			text: value === 'on' ? `@${display}, colorcycle enabled — chat color changes on every sent message.` : `@${display}, colorcycle disabled.`,
		};
	},
};
