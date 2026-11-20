const { got } = require('../token/got.js');
const z = require('zod');
const SupiDate = require('../util/date.js');
const { domainToASCII } = require('node:url');

const cachingSites = ['shouldiblamecach.ing', 'shouldiblamecaching.com'];
const querySchema = z.object({
	scan: z
		.object({
			last_scan: z.iso.datetime().optional(),
			error: z.string().optional(),
		})
		.optional(),
	warnings: z
		.object({
			scan_failed: z
				.array(
					z.object({
						type: z.string(),
						msg: z.string().optional(),
					}),
				)
				.optional(),
		})
		.optional(),
});

module.exports = {
	name: 'isdown',
	usage: 'isdown <domain>',
	cooldown: 10000,
	description: "Checks if a website is currently down or if it's just you.",
	flags: ['mention', 'pipe'],
	execute: async (client, msg) => {
		const [input] = msg.args;
		const fixedInput = domainToASCII(input) || input; // domainToASCII returns empty string for invalid input - hence ||
		if (cachingSites.some((i) => fixedInput.includes(i))) {
			return {
				success: true,
				text: `That website is currently up and available. However, this result may be invalid due to caching.`,
			};
		} else if (fixedInput.includes('shouldiblametmi.com')) {
			const emote = await msg.getBestAvailableEmote(['TMIAteMyMessage', 'Clue', 'OpieOP'], '😋');
			const [first, second] = bot.Utils.shuffleArray(['That website is currently up and available.', `Website is currently down: ${emote}`]);

			void msg.send(first);
			return {
				success: true,
				text: second,
			};
		}

		const response = await got('GenericAPI')({
			url: `https://sitecheck.sucuri.net/api/v3/?scan=${fixedInput}`,
		});

		if (!response.ok) {
			return {
				success: false,
				text: `Could not check if the website is down right now!`,
			};
		}

		const { scan, warnings } = querySchema.parse(response.body);
		if (!scan || scan.error) {
			return {
				success: false,
				text: `Cannot check website status! ${scan?.error ?? '(no error available)'}`,
			};
		}

		const lastScan = new SupiDate(scan.last_scan);
		const delta = bot.Utils.timeDelta(lastScan);

		if (Array.isArray(warnings?.scan_failed)) {
			const error = warnings.scan_failed[0].msg;
			if (error === 'Host not found') {
				return {
					success: false,
					text: `Provided website was not found!`,
				};
			} else {
				return {
					success: true,
					text: `Website is currently down: ${error ?? '(N/A)'}. Last scanned ${delta}.`,
				};
			}
		} else {
			return {
				success: true,
				text: `That website is currently up and available. Last scanned ${delta}.`,
			};
		}
	},
};
