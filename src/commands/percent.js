const { randomInt } = require('../util/command-utils.js');

const command = {
	name: 'percent',
	aliases: ['%'],
	cooldown: { user: 5 },
	access: { channel: 0 },
	description: 'Rolls a random percentage between 0 and 100%.',
	usage: 'percent',
	flags: ['mention', 'pipe', 'skip-banphrase'],
	execute: async ({ client, message: msg }) => {
		const number = randomInt(0, 10_000);
		return {
			success: true,
			text: `${number / 100}%`,
		};
	},
	dynamicDescription: (prefix) => ['Rolls a random percentage!', '', `<code>${prefix}%</code>`, 'Random percentage, between 0.00% to 100.00%'],
};

module.exports = { command };
