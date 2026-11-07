const { getPermissions } = require('../clients/modules/handler.js');
const { setTimeout: sleep } = require('node:timers/promises');

/**
 * Supibots pyramid (ninou2, 24.10.2026: "!pyramid EMOTEnameORtext Number"). Supibot schaltet ihn per Whitelist-Filter
 * frei - den gibt es hier nicht, daher Mods/Broadcaster/Administratoren.
 */
const REASONABLE_PYRAMID_MAXIMUM = 50; // Supibot: 10, ninou2 24.10.2026: "er will 50 maximal"
const DEFAULT_DELAY = 250;
// Grosse Pyramiden langsamer und nur eine je Channel zur Zeit (alexmoderat, 24.10.2026: "mach beides") - das
// Rate-Limit (100 Nachrichten / 30 s) gilt fuer den ganzen Account, nicht pro Channel
const SLOW_FROM_SIZE = 20;
const SLOW_DELAY = 1000;
const CHANNEL_COOLDOWN = 60_000;

const lineDelay = (size) => (size >= SLOW_FROM_SIZE ? SLOW_DELAY : DEFAULT_DELAY);

/** Channel-ID -> gesperrt bis (Infinity, solange eine Pyramide laeuft) */
const channelLocks = new Map();

/** Restsperre in Sekunden, null wenn frei; der Broadcaster wartet nur, solange gerade eine Pyramide laeuft */
const channelLockRemaining = (locks, channelId, isBroadcaster, now = Date.now()) => {
	const until = locks.get(channelId);
	if (until === undefined || until <= now || (isBroadcaster && until !== Infinity)) {
		return null;
	}
	return until === Infinity ? Infinity : Math.ceil((until - now) / 1000);
};

/** Zeilen einer Pyramide: 1..size..1 Wiederholungen */
const pyramidLines = (text, size) => {
	const counts = [...Array.from({ length: size }, (_, i) => i + 1), ...Array.from({ length: size - 1 }, (_, i) => size - 1 - i)];
	return counts.map((i) => text.repeat(i).trimEnd());
};

module.exports = {
	name: 'pyramid',
	cooldown: 60000,
	description: 'Creates a pyramid in chat. Only usable in chats where the bot is a VIP or a Moderator.',
	usage: 'pyramid <text> <size>',
	flags: ['mod'],
	params: [
		{ name: 'delay', type: 'number' },
		{ name: 'wait', type: 'boolean' },
	],
	execute: async (client, msg) => {
		const args = [...msg.args];
		if (!msg.channelData) {
			return {
				success: false,
				text: `Cannot use this command in private messages!`,
			};
		} else if (msg.channelData.mode !== 'Moderator' && msg.channelData.mode !== 'VIP') {
			return {
				success: false,
				text: 'Cannot create pyramids in a non-VIP/Moderator chat!',
			};
		} else if (args.length < 2) {
			return {
				success: false,
				text: 'You must provide some text to pyramid-ify and the size of the pyramid!',
			};
		}

		const words = [...args];
		const size = Number(words.pop());
		if (Number.isNaN(size)) {
			return {
				success: false,
				text: 'You must provide the size as the last parameter!',
			};
		} else if (!Number.isInteger(size) || size <= 0 || size > REASONABLE_PYRAMID_MAXIMUM) {
			return {
				success: false,
				text: `Your provided pyramid height is not a positive integer, or is larger than the maximum of (${REASONABLE_PYRAMID_MAXIMUM})!`,
			};
		}

		let delay = lineDelay(size);
		if (typeof msg.params.delay === 'number') {
			const permissions = getPermissions(msg);
			if (!permissions.administrator) {
				return {
					success: false,
					text: 'Only administrators can change the pyramid message delay!',
				};
			}

			delay = msg.params.delay;
			if (delay <= 0 || delay >= 10_000) {
				return {
					success: false,
					text: 'Provided delay is out of practical bounds!',
				};
			}
		}

		const text = `${words.join(' ')} `; // Leerzeichen fuers Aneinanderhaengen und die Laengenpruefung
		const limit = bot.Config.messageLimit;
		if (text.length * size > limit) {
			return {
				success: false,
				text: `Your pyramid is too wide! The longest line wouldn't fit into one message (${text.length * size}/${limit})`,
			};
		}

		const channelId = msg.channelData.id;
		const locked = channelLockRemaining(channelLocks, channelId, msg.user.perms.broadcaster);
		if (locked !== null) {
			return {
				success: false,
				text:
					locked === Infinity
						? 'A pyramid is already being built in this channel!'
						: `A pyramid was just built in this channel, try again in ${locked}s!`,
			};
		}

		channelLocks.set(channelId, Infinity);
		try {
			const awaitPromise = msg.params.wait ?? true;
			for (const line of pyramidLines(text, size)) {
				const promise = bot.Channels.send(msg.channelData, line);
				if (awaitPromise) {
					await promise;
				}

				await sleep(delay);
			}
		} finally {
			channelLocks.set(channelId, Date.now() + CHANNEL_COOLDOWN);
		}

		return {
			success: true,
			text: null,
		};
	},
};

Object.assign(module.exports, { lineDelay, channelLockRemaining, pyramidLines });
