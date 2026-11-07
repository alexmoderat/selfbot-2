const { randomInt } = require('../misc/command-utils.js');

module.exports = {
	name: 'coinflip',
	aliases: ['cf'],
	cooldown: 2500,
	description: 'Flips a coin, and shows you the result of it.',
	usage: 'coinflip',
	// no-prefix: dburgers2/alexmoderat, 20.10.2026 (aus sb-v2)
	flags: ['mention', 'no-prefix', 'pipe', 'skip-banphrase'],
	params: [{ name: 'fail', type: 'boolean' }],
	execute: async (client, msg) => {
		// According to Murray & Teare (1993), the probability of an American silver nickel landing on its edge is around 1 in 6000 tosses
		const edgeRoll = randomInt(1, 6000);
		if (edgeRoll === 1) {
			return {
				text: 'The coin landed on its edge (!!)',
			};
		}

		const flipRoll = randomInt(1, 2);
		const reply = flipRoll === 1 ? 'Heads (yes)' : 'Tails (no)';

		// if the `fail` parameter is `true`, then fail the command with success: false on the "no" result.
		let success = true;
		if (msg.params.fail === true) {
			success = flipRoll === 2;
		}

		return {
			success,
			reply,
		};
	},
	dynamicDescription: (prefix) => [
		'Flips a virtual coin, telling you which side it landed on.',
		'This is determined randomly.',
		'',

		`<code>${prefix}coinflip</code>`,
		`<code>${prefix}cf</code>`,
		'Shows which side the coin landed on.',
	],
};
