const { getPermissions } = require('../clients/modules/handler.js');
const { createClip, fetchChannelInfo } = require('../misc/twitch-info.js');

/**
 * Clip der letzten Sekunden des Live-Streams erstellen und verlinken, aus sb-v2 (ninou2, 02.10.2026). Laenge 5-60 s
 * (ninou2, 03.10.2026), optionaler Titel. Nur VIPs, Mods, Broadcaster - der Broadcaster kann es per
 * "clipthat everyone on" fuer alle freigeben. Aufrufe innerhalb von 20 s bekommen denselben Link.
 */
const REUSE_MS = 20_000;
const lastClip = new Map();
const TITLE_MAX = 100;

/**
 * Jeder Titel endet mit "BY @user", damit man sieht, wer den Clip ausgeloest hat - der Ersteller ist sonst immer
 * das Bot-Konto (ninou2, 06.11.2026: "all title should get at the end of them : BY @user"). Gekuerzt wird der Titel, nie der Zusatz.
 */
const clipTitle = (base, user) => {
	const suffix = `BY @${user}`;
	const head = base
		.trim()
		.slice(0, TITLE_MAX - suffix.length - 1)
		.trim();
	return head ? `${head} ${suffix}` : suffix;
};

module.exports = {
	name: 'clipthat',
	cooldown: 3000,
	description:
		'Creates a clip (default 60 seconds, up to 60) of the last seconds of the live stream and posts the link (VIPs, mods, broadcaster; optional length like 25s (5-60) and custom title; the broadcaster can open it to everyone with "clipthat everyone on").',
	usage: 'clipthat [5s-60s] [title] | clipthat everyone <on|off>',
	execute: async (client, msg) => {
		const words = [...msg.args];
		const display = msg.displayName;
		const channel = msg.channelData;
		if (!channel?.twitchId) {
			return { text: null };
		}

		const permissions = getPermissions(msg);
		const isVip = Boolean(msg.user.badges.some((i) => i.set_id === 'vip'));
		const privileged = isVip || permissions.moderator;
		const everyone = (await bot.Channels.getData(channel, 'clipthatEveryone')) === true;
		if (!privileged && !everyone) {
			return { text: null };
		}

		// "everyone" nur als Unterbefehl, wenn es allein oder mit on/off steht - ein Titel darf so beginnen
		const [sub, value] = words;
		const isToggle = sub?.toLowerCase() === 'everyone' && words.length <= 2 && (value === undefined || ['on', 'off'].includes(value.toLowerCase()));
		if (isToggle) {
			const mayChange = msg.user.perms.broadcaster || permissions.administrator;
			const v = value?.toLowerCase();
			if (v !== 'on' && v !== 'off') {
				return {
					text: `@${display}, clipthat for everyone in #${channel.name} is ${everyone ? 'on' : 'off'}.${mayChange ? ` Usage: ${msg.invocation} everyone <on|off>` : ''}`,
				};
			}
			if (!mayChange) {
				return { text: `@${display}, only the broadcaster can change that.` };
			}

			await bot.Channels.setData(channel, 'clipthatEveryone', v === 'on');
			return { text: `@${display}, clipthat for everyone in #${channel.name} ${v === 'on' ? 'enabled' : 'disabled'}.` };
		}

		const recent = lastClip.get(channel.id);
		if (recent && Date.now() - recent.at < REUSE_MS) {
			return { text: `@${display}, ${recent.seconds}s clip: ${recent.url}` };
		}

		let seconds = 60;
		let rest = words;
		const lengthMatch = /^(\d{1,3})s$/i.exec(words[0] ?? '');
		if (lengthMatch) {
			seconds = Number(lengthMatch[1]);
			rest = words.slice(1);
			if (seconds < 5 || seconds > 60) {
				return { text: `@${display}, the clip length must be between 5s and 60s.` };
			}
		}

		// Ohne eigenen Titel nimmt Twitch den Stream-Titel - den hier selbst holen, damit der Zusatz dranhaengen kann
		const base = rest.join(' ').trim() || (await fetchChannelInfo(channel.twitchId).catch(() => null))?.title || '';
		const result = await createClip(channel.twitchId, seconds, clipTitle(base, display));
		if ('error' in result) {
			const why =
				result.error === 'offline'
					? `${channel.name} is not live right now.`
					: result.error === 'forbidden'
						? `clips are not allowed in #${channel.name} for the bot account.`
						: 'could not create the clip, try again in a moment.';
			return { text: `@${display}, ${why}` };
		}

		const url = `https://clips.twitch.tv/${result.id}`;
		lastClip.set(channel.id, { url, at: Date.now(), seconds });
		return { text: `@${display}, ${seconds}s clip: ${url}${result.ready ? '' : ' (still processing)'}` };
	},
};

Object.assign(module.exports, { clipTitle });
