const SupiDate = require('../misc/date.js');
const { fetchTimeData, formatTimezoneOffset, parseChrono } = require('../misc/command-utils.js');

// SQL DATETIME limit - 9999-12-31 23:59:59.999
const MAXIMUM_SQL_TIMESTAMP = 253_402_297_199_999;
const MESSAGE_LIMIT = 2000;

module.exports = {
	name: 'remind',
	// Supibot hat auch "notify" - das ist hier sb-v2s notify (Block 8, alexmoderat 24.10.2026: sb-v2 notify + subscribe)
	aliases: ['remindme', 'remindprivate', 'privateremind'],
	cooldown: 10000,
	description:
		'Sets a notification for a given user. Can also set a time to ping that user (or yourself) in a given amount of time, but in that case you must use the word "in" and then a number specifying the amount days, hours, minutes, etc.',
	usage: 'remind (user) (text) [in (time)] | remindme (text) in (time)',
	// "!remind" wie beim utility-bot - in dessen Channels antwortet weiter er (values.utilityChannels), alexmoderat 24.10.2026
	flags: ['mention', 'no-prefix', 'pipe'],
	params: [
		{ name: 'after', type: 'string' },
		{ name: 'at', type: 'string' },
		{ name: 'in', type: 'string' },
		{ name: 'on', type: 'string' },
		{ name: 'private', type: 'boolean' },
	],
	execute: async (client, msg) => {
		const args = [...msg.args];
		const { params } = msg;
		const chronoParams = Object.keys(params).filter((i) => i !== 'private');
		if (chronoParams.length > 1) {
			return {
				success: false,
				text: `Cannot specify more than one of the parameters "after", "at", "in" and "on" at the same time!`,
			};
		}

		const chronoParam = params.after ?? params.at ?? params.in ?? params.on ?? null;
		if (!chronoParam && args.length === 0) {
			return {
				success: false,
				text: `Incorrect syntax! Use "remind (person) (text)" or check the command's help for more info.`,
				cooldown: 2500,
			};
		}

		let targetUser = args[0] ? await bot.Users.get(args[0]) : null;

		if (msg.invocation.endsWith('me') || args[0] === 'me' || (targetUser && targetUser.id === msg.sender.id)) {
			targetUser = msg.sender;

			if (!msg.invocation.includes('me')) {
				args.shift();
			}
		} else if (!targetUser) {
			return {
				success: false,
				text: 'An invalid user was provided!',
				cooldown: module.exports.cooldown / 2,
			};
		} else {
			args.shift();
		}

		// Supibot prueft hier Message_Meta_User_Alias; User entstehen hier nur durch Chatten, also reicht die Existenz.
		// Supibots "I'm always here"-Sperre fuer den Bot selbst entfaellt: der Bot ist alexmoderat.

		let isPrivate = Boolean(msg.invocation.includes('private') || params.private);
		if (isPrivate && msg.channelData) {
			return {
				success: false,
				text: 'You must create private reminders in private messages only!',
				cooldown: module.exports.cooldown / 2,
			};
		}

		let reminderText = args.join(' ').replaceAll(/\s+/g, ' ').trim();
		const timedRegex = /\b(in|at)\b/i;
		let targetReminderDate = null;
		let targetReminderDelta = 'when they next type in chat';
		let delta = 0;

		const now = new SupiDate();
		if (chronoParam) {
			let chronoValue = (params.after && !chronoParam.includes(':')) || params.in ? `in ${chronoParam}` : chronoParam;

			chronoValue = chronoValue
				.replaceAll(/(\b|\d)hr(\b|\d)/g, '$1hr$2')
				.replaceAll(/(\b|\d)m(\b|\d)/g, '$1min$2')
				.replaceAll(/(\b|\d)s(\b|\d)/g, '$1sec$2');

			const preCheckChronoData = parseChrono(chronoValue);
			if (!preCheckChronoData) {
				return {
					success: false,
					text: 'Invalid time provided!',
				};
			}

			const { isRelative } = preCheckChronoData;
			const location = await bot.Users.getData(msg.sender, 'location');
			const hasExplicitTimezone = preCheckChronoData.component.isCertain('timezoneOffset');

			let referenceDate;
			if (!hasExplicitTimezone && !isRelative && location) {
				const response = await fetchTimeData({
					date: new SupiDate(preCheckChronoData.component.date()),
					coordinates: location.coordinates,
				});

				const timeData = response.body;
				if (timeData.status === 'ZERO_RESULTS') {
					return {
						success: false,
						text: `Could not process your timezone!`,
					};
				}

				const prettyOffset = formatTimezoneOffset(timeData);
				chronoValue += ` UTC${prettyOffset}`;

				referenceDate = new SupiDate();
				referenceDate.setTimezoneOffset((timeData.rawOffset + timeData.dstOffset) / 60);
			}

			const chronoData = parseChrono(chronoValue, referenceDate, { forwardDate: false });
			if (!chronoData) {
				return {
					success: false,
					text: 'Invalid time provided!',
				};
			}

			targetReminderDate = new SupiDate(chronoData.component.date());

			// S#12177
			// If there is no user-provided day value (e.g. "2 am") and that timestamp has already been passed today,
			// automatically add one day to the resulting date object - we assume it's tomorrow.
			if (!chronoData.component.isCertain('day') && chronoData.date < now) {
				targetReminderDate.addDays(1);
			}

			targetReminderDate.milliseconds = now.milliseconds;
			delta = bot.Utils.round(targetReminderDate.valueOf() - now.valueOf(), -3);
		} else if (timedRegex.test(reminderText)) {
			reminderText = reminderText.replaceAll(/\bhr\b/g, 'hour');
			const timeData = bot.Utils.parseDuration(reminderText, { returnData: true });

			if (timeData.ranges.length > 0) {
				const continueRegex = /^((\s*and\s*)|[\s\W]+)$/;
				let continues = false;

				for (let i = 0; i < timeData.ranges.length; i++) {
					// If the preceding text doesn't contain the word "in" right before the time range, skip it.
					const precedingText = reminderText.slice(0, timeData.ranges[i].start);
					if (!continues && !/\bin\b\s*$/.test(precedingText)) {
						continue;
					}

					continues = false;
					const current = timeData.ranges[i];
					const next = timeData.ranges.at(i + 1);

					delta += current.time;
					targetReminderDate = targetReminderDate ?? SupiDate.now();
					targetReminderDate += current.time;

					// Parse out the text between ranges, ...
					const between = next ? reminderText.slice(current.end, next.start) : '';

					// Remove the possible preceding "in" keyword, regardless of which range it is used in
					const keywordIndex = reminderText.slice(0, current.start).lastIndexOf('in');
					if (current.start - keywordIndex === 3) {
						reminderText = reminderText.slice(0, keywordIndex) + '\u0000'.repeat(3) + reminderText.slice(current.start);
					}

					// and only continue if it matches a "time word separator", such as the word "and", space, comma, ...
					if (!continueRegex.test(between)) {
						reminderText = reminderText.slice(0, current.start) + reminderText.slice(current.end);
						break;
					} else if (next) {
						const amount = next.start - current.start;
						reminderText = reminderText.slice(0, current.start) + '\u0000'.repeat(amount) + reminderText.slice(next.start);
						continues = true;
					}
				}

				reminderText = reminderText.replaceAll('\u0000', '');
			}
		}

		if (targetReminderDate) {
			if (typeof targetReminderDate === 'number') {
				targetReminderDate = new SupiDate(targetReminderDate);
				targetReminderDelta = bot.Utils.timeDelta(targetReminderDate, true);
			} else {
				targetReminderDelta = bot.Utils.timeDelta(targetReminderDate, true);
			}

			const comparison = new SupiDate(now.valueOf() + delta);
			if (delta < 0) {
				return {
					success: false,
					text: 'Past reminders are only available to people who possess a time machine!',
				};
			} else if (now > comparison) {
				return {
					success: false,
					text: 'Timed reminders set in the past are only available for people that posess a time machine!',
				};
			} else if (Math.abs(now.valueOf() - comparison.valueOf()) < 30_000) {
				return {
					success: false,
					text: 'You cannot set a timed reminder in less than 30 seconds!',
					cooldown: module.exports.cooldown / 2,
				};
			} else if (SupiDate.now() + delta > MAXIMUM_SQL_TIMESTAMP) {
				const description = Number.isFinite(comparison.valueOf())
					? `the date ${comparison.format('Y-m-d')}`
					: `approximately ${bot.Utils.groupDigits(Math.trunc(delta / 31_536_000_000))} years in the future`;

				return {
					success: false,
					text: `Your reminder was set to ${description}, but the limit is December 31st 9999.`,
					cooldown: module.exports.cooldown / 2,
				};
			}
		} else if (targetUser === msg.sender) {
			return {
				success: false,
				text: bot.Utils.tag.trim`
					To remind yourself, you must use the word "in"!
					Such as: "in 5 minutes".
				    You can also use the "on", "at" or "after" parameters
				    Such as: "on:Sunday" or at:"5:30 pm" or "after:30min"
				`,
				cooldown: 2500,
			};
		}

		// If it is a timed reminder via PMs, only allow it if it is a self reminder.
		// Scheduled reminders for users via PMs violate the philosophy of reminders.
		if (msg.privateMessage && delta !== 0 && !params.after) {
			if (targetUser === msg.sender) {
				isPrivate = true;
			} else {
				const forcePrivateString = params.private === false ? ' (no matter what you set the private parameter to)' : '';

				return {
					success: false,
					text: `You cannot create timed reminders${forcePrivateString} for someone else in private messages!`,
				};
			}
		}

		const type = params.after ? 'Deferred' : 'Reminder';
		const message = reminderText ? bot.Utils.wrapString(reminderText, MESSAGE_LIMIT) : '(no message)';

		const result = await bot.Reminders.create({
			Channel: msg.channelData?.id ?? null,
			Platform: bot.Twitch.ID,
			User_From: msg.sender.id,
			User_To: targetUser.id,
			Text: message.trim(),
			Created: new SupiDate(),
			Schedule: targetReminderDate ? new SupiDate(targetReminderDate) : null,
			Private_Message: isPrivate,
			Type: type,
		});

		if (result.success) {
			const who = targetUser.id === msg.sender.id ? 'you' : targetUser.name;
			const target = targetUser.id === msg.sender.id ? 'you' : 'they';
			const method = isPrivate ? 'privately ' : '';

			let message;
			if (type === 'Deferred') {
				message = `I will ${method}remind ${who} when ${target} type in chat after ${targetReminderDelta} (ID ${result.ID})`;
			} else {
				const deltaString = targetReminderDate === null ? targetReminderDelta : `in ${targetReminderDelta}`;
				message = `I will ${method}remind ${who} ${deltaString} (ID ${result.ID})`;
			}

			return {
				cooldown: msg.privateMessage ? 2500 : module.exports.cooldown,
				text: message,
			};
		} else {
			return {
				success: false,
				text: result.reason,
			};
		}
	},
	dynamicDescription: (prefix) => [
		'Reminds a given person.',
		'There are multiple ways to remind, either whenever they type, or a timed reminder.',
		'',

		`<code>${prefix}remind (person) hello :)</code>`,
		`<code>${prefix}notify (person) hello :)</code>`,
		'Reminds target person whenever they next type in a chat that has Supibot.',
		'There is no difference between <code>remind</code> and <code>notify</code>.',
		'',

		`<code>${prefix}unset reminder (ID)</code>`,
		`<code>${prefix}unset reminder last</code>`,
		'Deactivates and removes a reminder you have created (or someone has set for you), determined by its ID.',
		'You can also deactive the "last" reminder you created or someone created for you by using the "last" keyword.',
		`For full info, make sure to check the help article for the <a href="/bot/command/detail/unset">unset</a> command.`,
		'',

		`<code>${prefix}remindprivate (person) hello :)</code>`,
		`<code>${prefix}remind private:true (person) hello :)</code>`,
		'Privately reminds target person (via whispers/PMs) when they next type in a channel that has Supibot active.',
		'',

		`<code>${prefix}remind (person) hello :) in (time)</code>`,
		`<code>${prefix}remind supinic hello, how's it going? in 5 minutes</code>`,
		`<code>${prefix}remind supinic in 1 year, 3 months and 5 days hi to the future!</code>`,
		`<code>${prefix}remind (person) hi :) in:(time)!</code>`,
		`<code>${prefix}remind supinic test in:1hr</code>`,
		"Creates a timed remind for target person that's going to fire in whatever time you provide, in the channel you used the command in.",
		'You <b>must</b> use the keyword <code>in</code> followed by the time specification for this to work, or use the <code>in</code> parameter.',
		'The position of the time specification does not matter if used in text.',
		'',

		`<code>${prefix}remindme test (time)</code>`,
		`<code>${prefix}remind me check pasta in 5 minutes</code>`,
		'Creates a timed reminder for yourself, much like a regular timed reminder.',
		'',

		`<code>${prefix}remind (person) test on:8pm</code>`,
		`<code>${prefix}remindme fireworks at:"July 4th 2021, 8pm"</code>`,
		`<code>${prefix}remind (person) test on:"tomorrow 10am"</code>`,
		`<code>${prefix}remind (person) test on:"today evening"</code>`,
		`<code>${prefix}remind (person) test on:"10am UTC+3"</code>`,
		'Creates a timed reminder just like normal, but using a specific date + time to time it.',
		`Will use your timezone, if you have it set up via the <code>${prefix}set location</code> command.`,
		"If you don't, the command will use the server's timezone.",
		'There are plenty of words that you can use - like morning, evening, noon, midnight, ... and more',
		'',

		`<code>${prefix}remind (person) test after:8pm</code>`,
		`<code>${prefix}remindme check keys after:"tomorrow 10am"</code>`,
		'Creates a regular reminder that will only fire when you or target user type in chat <b>after</b> the provided time has passed.',
		'E.g. for the 10am example, any messages sent by yourself up to 10:00:00 will not make the reminder fire, whereas the first one afterwards will.',
		'',
	],
};
