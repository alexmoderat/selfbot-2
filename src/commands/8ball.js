const EIGHT_BALL_RESPONSES = [
	'😃 It is certain.',
	'😃 It is decidedly so.',
	'😃 Without a doubt.',
	'😃 Yes - definitely.',
	'😃 You may rely on it.',
	'😃 As I see it, yes.',
	'😃 Most likely.',
	'😃 Outlook good.',
	'😃 Yes.',
	'😃 Signs point to yes.',
	'😐 Reply hazy, try again.',
	'😐 Ask again later.',
	'😐 Better not tell you now.',
	'😐 Cannot predict now.',
	'😐 Concentrate and ask again.',
	"😦 Don't count on it.",
	'😦 My reply is no.',
	'😦 My sources say no.',
	'😦 Outlook not so good.',
	'😦 Very doubtful.',
];

module.exports = {
	name: '8ball',
	cooldown: 10000,
	description: 'Checks your question against the fortune-telling 8-ball.',
	usage: '8ball (question)',
	// no-prefix: dburgers2/alexmoderat, 20.10.2026 - bares "!8ball" soll auch gehen (aus sb-v2)
	flags: ['mention', 'no-prefix', 'pipe'],
	execute: async (client, msg) => {
		return {
			text: bot.Utils.randArray(EIGHT_BALL_RESPONSES),
		};
	},
	dynamicDescription: function (prefix) {
		const list = EIGHT_BALL_RESPONSES.map((i) => `<li>${i}</li>`).join('');

		return ['Consult the 8-ball for your inquiry!', '', `<code>${prefix}8ball Is this command cool?</code>`, '(random 8-ball response)', '', 'List of responses:', `<ul>${list}</ul>`];
	},
};
