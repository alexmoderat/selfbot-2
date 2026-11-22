const colorCycler = require('../util/color-cycler.js');

/** Account-weiter Schalter: wechselt bei jeder gesendeten Bot-Nachricht die Chat-Namensfarbe (aus sb-v2) */
const command = {
	name: 'colorcycle',
	cooldown: { user: 3 },
	access: { global: 1 },
	description: 'Toggles cycling through chat name colors on every sent message.',
	usage: 'colorcycle <on|off>',
	execute: async ({ client, message: msg }) => {
		const [state] = msg.args;
		const display = msg.displayName;
		const value = state?.toLowerCase();
		if (value !== 'on' && value !== 'off') {
			return `@${display}, colorcycle is ${colorCycler.isEnabled() ? 'on' : 'off'}. Usage: ${msg.prefix}${msg.invocation} <on|off>`;
		}

		await colorCycler.setEnabled(value === 'on');
		return value === 'on' ? `@${display}, colorcycle enabled — chat color changes on every sent message.` : `@${display}, colorcycle disabled.`;
	},
};

module.exports = { command,
	initialize: async () => {
		await colorCycler.initialize();
	},
};
