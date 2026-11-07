const { randomInt } = require('../misc/command-utils.js');

module.exports = {
	name: 'percent',
	aliases: ['%'],
	cooldown: 5000,
	description: 'Rolls a random percentage between 0 and 100%.',
	usage: 'percent',
	flags: ['mention', 'pipe', 'skip-banphrase'],
	execute: async (client, msg) => {
		const number = randomInt(0, 10_000);
		return {
			success: true,
			text: `${number / 100}%`,
		};
	},
	dynamicDescription: (prefix) => ['Rolls a random percentage!', '', `<code>${prefix}%</code>`, 'Random percentage, between 0.00% to 100.00%'],
};
