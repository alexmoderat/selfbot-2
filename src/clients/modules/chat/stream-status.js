const { got } = require('../../../token/got.js');
const { defineChatModule } = require('../chat-modules.js');
const { addStreamGameChange, clearStreamState, getStreamState, setStreamState } = require('../../../util/channel-stats.js');

/**
 * Stream-Start/-Ende, Raids, Shield-Mode und Titel-/Kategoriewechsel protokollieren, aus sb-v2. Haelt den Stream-Zustand
 * (Start, Spiel, Kategoriewechsel) fuer Stream-Statistiken (Block 6) und Benachrichtigungen (Block 8) - die
 * Live-/Titel-Ansagen selbst kommen mit Block 8. Start/Ende ueber EventSub stream.online/offline.
 */

const fetchCurrentGame = async (broadcasterId) => {
	const response = await got('Helix')({
		url: 'channels',
		searchParams: { broadcaster_id: broadcasterId },
	}).catch(() => null);

	return response?.body.data?.[0]?.game_name || null;
};

module.exports = defineChatModule({
	name: 'stream-status',
	description: 'Logs stream start/end, raids, shield mode and title/category changes, and keeps the stream state.',
	scope: 'global',
	handlers: {
		online: async (context) => {
			const { channel } = context;
			console.log(`[stream-status] Stream up: #${channel.name}`);
			const game = channel.twitchId ? await fetchCurrentGame(channel.twitchId) : null;
			await setStreamState(channel, game).catch((e) => console.warn('[stream-status]', e));
		},
		offline: async (context) => {
			console.log(`[stream-status] Stream down: #${context.channel.name}`);
			await clearStreamState(context.channel).catch((e) => console.warn('[stream-status]', e));
		},
		raid: (context) => {
			const payload = context.payload;
			if (!context.channel || !payload?.raid) {
				return;
			} else if (payload.type === 'raid_go_v2') {
				console.log(
					`[stream-status] Raid: #${context.channel.name} -> ${payload.raid.target_login ?? '?'} (${payload.raid.viewer_count ?? '?'} Viewer)`,
				);
			} else if (payload.type === 'raid_cancel_v2') {
				console.log(`[stream-status] Raid abgebrochen: #${context.channel.name} -> ${payload.raid.target_login ?? '?'}`);
			}
		},
		shieldMode: (context) => {
			const data = context.payload?.data;
			if (!context.channel || !data) {
				return;
			}

			const active = Boolean(data.is_shield_mode_active);
			const by = active ? data.shield_mode_last_activated_by?.login : data.shield_mode_last_deactivated_by?.login;
			console.log(`[stream-status] Shield Mode ${active ? 'AN' : 'AUS'} in #${context.channel.name} (by ${by ?? '?'})`);
		},
		broadcastSettings: async (context) => {
			const channel = context.channel;
			const payload = context.payload;
			if (!channel || !payload) {
				return;
			}

			const changes = [];
			if (payload.old_status !== payload.status) {
				changes.push(`Titel: "${payload.old_status ?? ''}" -> "${payload.status ?? ''}"`);
			}
			if (payload.old_game !== payload.game) {
				changes.push(`Kategorie: "${payload.old_game ?? ''}" -> "${payload.game ?? ''}"`);
			}
			if (changes.length > 0) {
				console.log(`[stream-status] #${channel.name} hat Stream-Infos geaendert: ${changes.join(' | ')}`);
			}

			if (payload.old_game !== payload.game && (await getStreamState(channel).catch(() => null))) {
				await addStreamGameChange(channel, payload.game ?? null).catch(() => {});
			}
		},
	},
});
