const { randomBytes } = require('node:crypto');
const { roll: diceRoll } = require('@jprochazk/roll-dice');
const { randomInt } = require('../util/command-utils.js');

module.exports = {
	name: 'roll',
	aliases: ['dice'],
	cooldown: 5000,
	description:
		'Rolls a random number. If nothing is specified, rolls 1-100. You can specify min and max values, or some expression using standard dice notation.',
	usage: 'roll [min max | NdM] [textOnly:true]',
	flags: ['mention', 'pipe', 'skip-banphrase'],
	params: [{ name: 'textOnly', type: 'boolean' }],
	execute: async (client, msg) => {
		const args = [...msg.args];
		if (args.length === 0) {
			const result = randomInt(1, 100);
			if (msg.params.textOnly) {
				return {
					text: String(result),
				};
			} else {
				return {
					text: `Your roll is ${result}.`,
				};
			}
		}

		const firstNum = Number(args[0]);
		const secondNum = Number(args[1]);
		if (args[0] && args[1] && Number.isSafeInteger(firstNum) && Number.isSafeInteger(secondNum)) {
			if (firstNum > Number.MAX_SAFE_INTEGER || secondNum > Number.MAX_SAFE_INTEGER) {
				return {
					success: false,
					text: 'That number is too large!',
				};
			} else if (firstNum < Number.MIN_SAFE_INTEGER || secondNum < Number.MIN_SAFE_INTEGER) {
				return {
					success: false,
					text: 'That negative number is too large!',
				};
			}

			const number = firstNum < secondNum ? randomInt(firstNum, secondNum) : randomInt(secondNum, firstNum);

			if (msg.params.textOnly) {
				return {
					text: String(number),
				};
			} else {
				return {
					text: `Your roll is ${number}.`,
				};
			}
		}

		const [fixedInput] = args.join(' ').split(/[a-ce-zA-Z]/, 1);
		const hexStringSeed = randomBytes(64).toString('hex');
		const seed = BigInt(`0x${hexStringSeed}`);

		let result;
		try {
			result = diceRoll(fixedInput, { seed, limit: 1_000_000n, strict: true });
		} catch (e) {
			const message = e instanceof Error ? e.message : String(e);
			return {
				success: false,
				text: `Cannot make this roll work! Error: ${message}`,
			};
		}

		if (msg.params.textOnly) {
			return {
				text: String(result),
			};
		} else {
			return {
				text: `Your roll is ${result}.`,
			};
		}
	},
	dynamicDescription: (prefix) => [
		'Rolls a random number.',
		'You can use multiple ways to determine the limits of your rolls.',
		'If you add the <code>textOnly:true</code> parameter, only the roll will be the output, without the surrounding text.',
		'',

		`<code>${prefix}roll</code>`,
		'Rolls between 1 and 100.',
		'',

		`<code>${prefix}roll (low) (high)</code>`,
		`<code>${prefix}roll 153 344</code>`,
		'Rolls between (low) and (high) numbers, inclusively.',
		'',

		`<code>${prefix}roll 1d100</code>`,
		`<code>${prefix}roll 5d25</code>`,
		`<code>${prefix}roll (1d5)d(25d100)</code>`,
		'Rolls using DnD dice format.',
	],
};
