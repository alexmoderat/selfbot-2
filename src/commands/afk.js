const { randArray, wrapString } = require('../misc/utility.js');
const { definitions } = require('../services/afk.js');

const { invocations, specialSuffixes } = definitions;
const STATUS_LENGTH_CHARACTER_LIMIT = 2000;

// Supibots afk
module.exports = {
	name: 'afk',
	aliases: ['gn', 'brb', 'shower', 'food', 'lurk', 'poop', '💩', 'work', 'study', 'nap'],
	cooldown: 10_000,
	description: 'Flags you as AFK. Supports a custom AFK message.',
	usage: 'afk [text]',
	flags: ['pipe'],
	dynamicDescription: (prefix) => [
		'Flags you as AFK (away from keyboard).',
		'While you are AFK, others can check if you are AFK.',
		'On your first message while AFK, the status ends and the bot will announce you coming back.',
		'Several aliases exist in order to make going AFK for different situations easier.',
		'',
		`<code>${prefix}afk (status)</code>`,
		'You are now AFK with the provided status',
		'',
		`<code>${prefix}poop (status)</code>`,
		'You are now pooping.',
		'',
		`<code>${prefix}brb (status)</code>`,
		'You will be right back.',
		'',
		'and more - check the aliases',
	],
	execute: async (client, msg) => {
		if (msg.privateMessage && bot.AFK.get(msg.sender)) {
			return { success: false, text: 'You are already AFK!' };
		}

		const target = invocations.find((i) => i.name === msg.invocation || i.aliases?.includes(msg.invocation));
		if (!target) {
			throw new Error(`AFK invocation does not match (${msg.invocation})`);
		}

		let text = msg.args.join(' ').trim();
		if (text.length === 0 && target.noTextString) {
			text = target.noTextString;
		}
		if (target.textSuffix) {
			text = `${text} ${target.textSuffix}`;
		}
		else if (target.specialSuffix) {
			text = `${text} ${randArray(specialSuffixes[target.specialSuffix])}`;
		}

		await bot.AFK.set(msg.sender, {
			text: wrapString(text, STATUS_LENGTH_CHARACTER_LIMIT, { keepWhitespace: false }),
			status: target.name,
			interruptedId: null,
		});

		return { success: true, text: `${msg.displayName} is ${target.status}: ${text}` };
	},
};
