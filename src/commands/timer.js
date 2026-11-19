const timers = require('../services/timers.js');
const { formatDuration } = require('../misc/duration.js');
const { uploadList } = require('../misc/haste.js');
const { MAX_MESSAGE_LENGTH, MAX_TIMERS_PER_CHANNEL, parseTimerInterval, timerMode } = require('../misc/timers.js');

/**
 * Wiederkehrende Nachrichten pro Channel (alexmoderat, 31.10.2026: "ja wir sollten mal timer adden"; Anlass ninou2:
 * Promo-Text "each 4/6 hours"). Versand in crons/timers, standardmaessig nur waehrend der Stream live ist; offline:true = immer,
 * onlyoffline:true = nur wenn der Stream offline ist (alexmoderat, 19.11.2026: automatisches +ed alle 1 h 10 s bei ninou2,
 * DeepDankDungeonBot antwortet nur offline - ninou2: "if im offline, it type +ED in here").
 */
const MAX_INLINE = 350;
const PREVIEW_LENGTH = 40;

const describe = (timer) => {
	const preview = timer.Message.length > PREVIEW_LENGTH ? `${timer.Message.slice(0, PREVIEW_LENGTH)}…` : timer.Message;
	const flags = [timerMode(timer), ...(timer.Enabled ? [] : ['off'])];
	return `#${timer.ID} every ${formatDuration(timer.Interval_Seconds * 1000)} (${flags.join(', ')}): ${preview}`;
};

module.exports = {
	name: 'timer',
	aliases: ['timers'],
	cooldown: 3000,
	description: 'Posts a message in this channel every X time (by default only while the stream is live).',
	usage: 'timer add <interval> <text> [offline:true | onlyoffline:true] | timer list | timer remove|on|off <id> | timer edit <id> [interval:4h] [text]',
	flags: ['mod'],
	params: [
		{ name: 'interval', type: 'string' },
		{ name: 'offline', type: 'boolean' },
		{ name: 'onlyoffline', type: 'boolean' },
	],
	execute: async (client, msg) => {
		const [sub, ...args] = msg.args;
		const display = msg.displayName;
		const channel = msg.channelData;
		if (!channel) {
			return { text: `@${display}, this only works in a channel.` };
		}

		const usage = `${msg.prefix}${msg.invocation} add <interval> <text> | list | remove|on|off|edit <id>`;
		const action = sub?.toLowerCase() ?? 'list';
		const all = await timers.list(channel);

		if (action === 'list') {
			if (all.length === 0) {
				return { text: `@${display}, no timers in #${channel.name}. Usage: ${usage}` };
			}

			const text = all.map(describe).join(' · ');
			if (text.length <= MAX_INLINE) {
				return { text: `@${display}, ${all.length} timer(s) in #${channel.name}: ${text}` };
			}

			const link = await uploadList(
				`Timers in #${channel.name}`,
				all.map(
					(i) =>
						`#${i.ID} every ${formatDuration(i.Interval_Seconds * 1000)} (${timerMode(i)}${i.Enabled ? '' : ', off'}): ${i.Message}`,
				),
			);
			return { text: `@${display}, ${all.length} timers in #${channel.name}: ${link}` };
		}

		if (action === 'add') {
			const [intervalRaw, ...words] = args;
			const ms = intervalRaw ? parseTimerInterval(intervalRaw) : null;
			const message = words.join(' ').trim();
			if (!ms || !message) {
				return { text: `@${display}, Usage: ${msg.prefix}${msg.invocation} add <interval 5m-7d, e.g. 4h> <text> [offline:true | onlyoffline:true]` };
			} else if (message.length > MAX_MESSAGE_LENGTH) {
				return { text: `@${display}, the text is too long (max ${MAX_MESSAGE_LENGTH} characters).` };
			} else if (all.length >= MAX_TIMERS_PER_CHANNEL) {
				return { text: `@${display}, #${channel.name} already has ${MAX_TIMERS_PER_CHANNEL} timers, remove one first.` };
			}

			const offlineOnly = msg.params.onlyoffline === true;
			const onlineOnly = !offlineOnly && msg.params.offline !== true;
			const id = await timers.add(channel, message, Math.round(ms / 1000), onlineOnly, msg.sender.name, offlineOnly);
			const when = offlineOnly
				? 'only while the stream is offline, first one within a minute of going offline'
				: onlineOnly
					? 'while the stream is live, first one within a minute of going live'
					: 'first one within a minute';
			return { text: `@${display}, ✅ timer #${id} added: every ${formatDuration(ms)}, ${when}.` };
		}

		if (!['remove', 'delete', 'on', 'off', 'edit'].includes(action)) {
			return { text: `@${display}, Usage: ${usage}` };
		}

		const id = Number(args[0]?.replace(/^#/, ''));
		const existing = all.find((i) => i.ID === id);
		if (!existing) {
			return { text: `@${display}, timer "${args[0] ?? ''}" not found in #${channel.name}. See: ${msg.prefix}${msg.invocation} list` };
		}

		if (action === 'remove' || action === 'delete') {
			await timers.remove(existing);
			return { text: `@${display}, ✅ timer #${existing.ID} removed.` };
		} else if (action === 'on' || action === 'off') {
			await timers.update(existing, { Enabled: action === 'on' });
			return { text: `@${display}, ✅ timer #${existing.ID} is now ${action}.` };
		}

		// edit: neues Intervall per interval:, neuer Text als Rest, Live-Bedingung per offline: / onlyoffline:
		const values = {};
		if (msg.params.interval !== undefined) {
			const ms = parseTimerInterval(msg.params.interval);
			if (!ms) {
				return { text: `@${display}, invalid interval, use e.g. interval:4h (5m-7d).` };
			}
			values.Interval_Seconds = Math.round(ms / 1000);
		}
		if (msg.params.offline !== undefined) {
			values.Online_Only = !msg.params.offline;
			values.Offline_Only = false;
		}
		if (msg.params.onlyoffline !== undefined) {
			values.Offline_Only = msg.params.onlyoffline;
			values.Online_Only = msg.params.onlyoffline ? false : (values.Online_Only ?? existing.Online_Only);
		}

		const message = args.slice(1).join(' ').trim();
		if (message.length > MAX_MESSAGE_LENGTH) {
			return { text: `@${display}, the text is too long (max ${MAX_MESSAGE_LENGTH} characters).` };
		} else if (message) {
			values.Message = message;
		}

		if (Object.keys(values).length === 0) {
			return { text: `@${display}, Usage: ${msg.prefix}${msg.invocation} edit <id> [interval:4h] [offline:true | onlyoffline:true] [new text]` };
		}

		await timers.update(existing, values);
		return { text: `@${display}, ✅ timer #${existing.ID} updated: ${describe({ ...existing, ...values })}` };
	},
};
