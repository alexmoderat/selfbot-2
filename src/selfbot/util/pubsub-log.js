const { LogLevel } = require('../../misc/logger.js');
const humanizeDuration = require('../../misc/humanizeDuration.js');

// Log-Zeilen fuer PubSub-Events, im Wortlaut von DontAddThisBots pubSubHandler.js (dort gehen dieselben Texte als
// Announce in den Chat bzw. als Discord-Meldung raus): "<channel> went live!", "went offline!", "changed to new game: ...",
// "changed to new title: ...", Moderationsaktion mit "Duration: ...". Fehlermeldungen ebenfalls wie bei Dont.

/**
 * @param {string} prefix Topic-Praefix (z. B. 'video-playback-by-id')
 * @param {any} payload
 * @param {string|null} channelName Login des Channels, falls bekannt
 * @returns {{ level: string, text: string } | null} null = kein Log fuer dieses Event (z. B. viewcount)
 */
const describe = (prefix, payload, channelName) => {
	const name = channelName ?? '?';
	const type = payload?.type;

	if (['video-playback-by-id', 'broadcast-settings-update', 'chatrooms-user-v1'].includes(prefix) && !type) {
		return { level: LogLevel.ERROR, text: `Unknown message without type: ${JSON.stringify(payload)}` };
	}

	if (prefix === 'video-playback-by-id') {
		if (type === 'stream-up') {
			return { level: LogLevel.INFO, text: `${name} went live!` };
		} else if (type === 'stream-down') {
			return { level: LogLevel.INFO, text: `${name} went offline!` };
		}
		return null;
	}

	if (prefix === 'broadcast-settings-update' && type === 'broadcast_settings_update') {
		const lines = [];
		if (payload.game_id !== payload.old_game_id) {
			lines.push(`${payload.channel ?? name} changed to new game: ${payload.game}`);
		}
		if (payload.status !== payload.old_status) {
			lines.push(`${payload.channel ?? name} changed to new title: ${payload.status}`);
		}
		return lines.length > 0 ? { level: LogLevel.INFO, text: lines.join(' | ') } : null;
	}

	if (prefix === 'chatrooms-user-v1' && type === 'user_moderation_action') {
		const { action, expires_in_ms: expires } = payload.data ?? {};
		if (!action) {
			return null;
		}
		const duration = expires ? `Duration: ${humanizeDuration(expires)}` : 'Duration: false';
		const level = action === 'timeout' || action === 'ban' ? LogLevel.WARN : LogLevel.INFO;
		return { level, text: `${name} ${String(action).toUpperCase()} ${duration}` };
	}

	return null;
};

module.exports = { describe };
