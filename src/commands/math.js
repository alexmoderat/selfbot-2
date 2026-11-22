const { got } = require('../token/got.js');
const z = require('zod');

const querySchema = z.union([z.object({ result: z.string(), error: z.null() }), z.object({ result: z.null(), error: z.string() })]);

const command = {
	name: 'math',
	aliases: ['calculate', 'calc'],
	usage: 'math <expression> [fixed:true] [precision:N]',
	cooldown: { user: 5 },
	access: { channel: 0 },
	description: 'Does math. For more info, check the documentation for math.js.',
	flags: ['external-input', 'mention', 'non-nullable', 'pipe'],
	params: [
		{ name: 'fixed', type: 'boolean' },
		{ name: 'precision', type: 'number' },
	],
	execute: async ({ client, message: msg }) => {
		const args = [...msg.args];
		if (args.length === 0) {
			return {
				success: false,
				text: 'No input provided!',
			};
		}

		const parameters = {
			expr: args.join(' '),
		};

		if (msg.params.precision) {
			if (!bot.Utils.isValidInteger(msg.params.precision)) {
				return {
					success: false,
					text: 'Provided precision must be a positive integer!',
				};
			}

			parameters.precision = msg.params.precision;
		}

		if (msg.params.fixed === true) {
			parameters.expr = `format((${parameters.expr}), { notation: "fixed" })`;
		}

		const response = await got('GenericAPI')({
			method: 'POST',
			responseType: 'json',
			throwHttpErrors: false,
			url: 'https://api.mathjs.org/v4',
			json: parameters,
		});

		const { error, data } = querySchema.safeParse(response.body);
		if (error || data.error || !data.result) {
			const message = data?.error ?? 'The math API is currently unavailable';
			return {
				success: false,
				text: `Could not evaluate! ${message}`,
			};
		}

		let reply = data.result;
		if (msg.params.fixed !== false) {
			reply = reply.replaceAll(/(^")|("$)/g, '');
		}

		return {
			success: true,
			text: reply,
		};
	},
	dynamicDescription: (prefix) => [
		'Calculates advanced maths. You can use functions, derivatives, integrals, methods, ...',
		`Look here for more info: <a href="https://mathjs.org/">mathjs documentation</a>`,
		'',

		'Simple math:',
		`<code>${prefix}math 9+10</code>`,
		'19',
		'',

		'Conversions between units:',
		`<code>${prefix}math 100 inches to cm</code>`,
		'254 cm',
		'',

		'Precision:',
		'When <code>precision</code> parameter is provided, the result will be trimmed to keep that many precision digits in.',
		`<code>${prefix}math (expression) <u>precision:(number)</u></code>`,
		`<code>${prefix}math 1/3 precision:2</code> => 0.33`,
		`<code>${prefix}math 2/3 precision:6</code> => 0.666666`,
		'',

		'Fixed notation:',
		'When <code>fixed:true</code> is provided, the result will use a fixed notation, rather than the default exponential notation.',
		`<code>${prefix}math (expression) <u>fixed:false</u></code>`,
		`<code>${prefix}math 1000 * 1000 fixed:true</code> => 1000000`,
		`<code>${prefix}math 1000 * 1000 fixed:false</code> => 1e+6`,
	],
};

module.exports = { command };
