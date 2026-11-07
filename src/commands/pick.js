module.exports = {
	name: 'pick',
	cooldown: 10000,
	description: 'Picks a single word from the provided list of words in a message.',
	usage: 'pick (list of words) [delimiter:;]',
	flags: ['mention', 'pipe'],
	params: [{ name: 'delimiter', type: 'regex' }],
	execute: async (client, msg) => {
		const words = [...msg.args];
		if (words.length === 0) {
			return {
				success: false,
				text: 'No input provided!',
			};
		}

		const splitRegex = msg.params.delimiter ?? /\s+/;

		// normalize input - there might be arguments with other or multiple whitespace inside them
		const prepared = words.join(' ').split(splitRegex).filter(Boolean);
		const word = bot.Utils.randArray(prepared);

		return {
			success: true,
			text: word,
		};
	},
	dynamicDescription: (prefix) => [
		'Picks a single word from a list in your message.',
		'',

		`<code>${prefix}pick (list of words)</code>`,
		`<code>${prefix}pick a b c d e</code>`,
		'Returns exactly one word - a letter in this case.',
		'The words are separated by any amount of spaces or other whitespace.',

		`<code>${prefix}pick <u>delimiter:;</u> a;b;c;d;e</code>`,
		'Returns exactly one word - like in previous example.',
		'The words are separated by a delimiter character or string of characters, specified by you.',

		'Another example of delimiters:',
		`<code>${prefix}pick <u>delimiter:;</u> one word; two words; three words</code>`,
		'<code>two words</code>',
	],
};
