const { getStreamInfo } = require('../misc/stream-info.js');

/** Stream-Infos, aus sb-v2; "uptime" als Kurzfassung (ninou2, 03.10.2026 probierte !uptime) */
module.exports = {
	name: 'si',
	aliases: ['streaminfo', 'uptime'],
	cooldown: 3000,
	description:
		'Stream info: viewers, category, uptime, bitrate/FPS/resolution, clips (24h). Offline: how long and last category. Defaults to the current channel; "uptime" gives a short answer.',
	usage: 'si [username]',
	flags: ['mod'],
	execute: async (client, msg) => {
		const [targetRaw] = msg.args;
		const display = msg.displayName;
		const target = (targetRaw ?? msg.channelData?.name ?? '').toLowerCase().replace(/^[@#]+/, '');
		if (!target) {
			return { text: `@${display}, Usage: ${msg.invocation} [username]` };
		}

		let info;
		try {
			info = await getStreamInfo(target);
		} catch (e) {
			const message = e instanceof Error ? e.message : String(e);
			console.warn(`[si] ${target}: ${message}`);
			return { text: `@${display}, Error fetching stream info: ${message}` };
		}

		if (!info) {
			return { text: `@${display}, User "${target}" not found.` };
		}

		if (msg.invocation === 'uptime') {
			return {
				text: info.live
					? `@${display}, ${info.displayName} has been live for ${info.uptime} (${info.viewers} viewers, ${info.gameName})`
					: `@${display}, ${info.displayName} has been offline for ${info.offlineSince || 'unknown'}${info.lastGame ? ` (last game: ${info.lastGame})` : ''}`,
			};
		}

		if (info.live) {
			const parts = [
				`@${info.displayName} is live with ${info.viewers} viewers`,
				`playing ${info.gameName}`,
				`for ${info.uptime}`,
				info.hls?.bitrate ? `Bitrate: ${info.hls.bitrate} kbps` : null,
				info.hls?.fps ? `FPS: ${info.hls.fps}` : null,
				info.hls?.resolution ? `Resolution: ${info.hls.resolution}` : null,
				`Clips (24h): ${info.clipCount}`,
				info.title ? `Title: ${info.title}` : null,
				info.thumb ? `Preview: ${info.thumb}` : null,
			].filter(Boolean);
			return { text: parts.join(' · ') };
		}

		const ago = info.offlineSince ? `${info.offlineSince} ago` : 'unknown';
		const titlePart = info.lastTitle ? `. title: ${info.lastTitle}` : '';
		return { text: `@${display}, user @${info.displayName} was last seen live ${ago}, playing "${info.lastGame}"${titlePart}` };
	},
};
