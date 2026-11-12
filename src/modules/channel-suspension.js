const { defineChatModule } = require('../clients/modules/chat-modules.js');

const { getSuspension, reactivateChannel, suspendChannel } = require('../services/channel-suspension.js');
const { setModerator } = require('../services/channel-manager.js');

/**
 * Wertet Meldungen zum Zustand eines Channels aus, aus sb-v2 (dort IRC-NOTICEs). Ohne IRC kommen sie hier als
 * "channelState": msg_channel_suspended aus einem widerrufenen EventSub-Abo (user_removed), die anderen als
 * Drop-Grund beim Senden ueber Helix.
 *   msg_channel_suspended   Account gesperrt/geloescht -> Channel still verlassen (ban-check holt ihn zurueck)
 *   msg_channel_restricted  Feature-Sperre (FLC) -> drinbleiben, nur melden
 *   msg_suspended_channel   dito
 *   msg_banned              Bot selbst gebannt -> Channel inaktiv setzen wie DontAddThisBot (isChannel: false), kein
 *                           Auto-Ban des Owners mehr (alexmoderat, 08.11.2026). Grund "bot_banned" holt ban-check nicht
 *                           automatisch zurueck - ob der Bot entbannt wurde, sieht er nicht; zurueck nur per Hand (join).
 * Dazu wie DontAddThisBot (pubSubHandler, user_moderation_action) die Bans des eigenen Kontos aus PubSub
 * chatrooms-user-v1: ban -> inaktiv (bot_banned), unban -> wieder aktiv mit dem vorherigen Mode.
 * Eigenes Unmod (chat_moderator_actions) -> sofort Mode Write; neue Mod-Rechte erkennt auto-join (alle 2 min).
 * Ein gesperrter Channel, in dem der Bot schon ist, meldet sich nicht zwingend - das uebernimmt der Cron ban-check.
 */
const BOT_BANNED = new Set(['bot_banned']);
const flcChannels = new Map();

const getFlcChannels = () => flcChannels;

module.exports = defineChatModule({
	name: 'channel-suspension',
	description: 'Handles channel state notices (suspension, feature restriction, bot banned).',
	scope: 'global',
	handlers: {
		channelState: async (context) => {
			const { channel, msgId, text } = context;
			const platform = bot.Twitch;

			if (msgId === 'msg_channel_suspended') {
				if (await suspendChannel(channel, 'suspended')) {
					console.warn(`[channel-suspension] #${channel.name} hat einen Twitch-Ban (${text})`);
				}
				return;
			} else if (msgId === 'msg_channel_restricted' || msgId === 'msg_suspended_channel') {
				console.warn(`[channel-suspension] #${channel.name} ist feature-restricted (${msgId})`);
				flcChannels.set(channel.id, { type: msgId, detectedAt: new Date().toISOString() });
				await platform.sendToBroadcaster(`⚠️ FLC-Restriction in ${channel.name}: ${msgId}`, platform.selfId).catch(() => {});
				return;
			} else if (msgId === 'msg_banned') {
				if (await suspendChannel(channel, 'bot_banned')) {
					console.warn(`[channel-suspension] Bot ist in #${channel.name} gebannt, Channel inaktiv`);
				}
				return;
			}

			console.log(`[channel-suspension] #${channel.name}: ${msgId} - "${text}"`);
		},
		modAction: async (context) => {
			const data = context.payload?.data;
			const target = String(data?.args?.[0] ?? data?.target_user_login ?? '').toLowerCase();
			if (data?.moderation_action === 'unmod' && context.channel && target === bot.Twitch.selfName.toLowerCase()) {
				await setModerator(context.channel, false);
			}
		},
		chatroomsUser: async (context) => {
			const { type, data } = context.payload ?? {};
			if (type !== 'user_moderation_action' || !data?.channel_id) {
				return;
			}

			const channel = bot.Channels.getByTwitchId(String(data.channel_id));
			console.warn(`[channel-suspension] ${new Date().toISOString()} Eigenes Konto: ${data.action} in #${channel?.name ?? data.channel_id}`);
			if (!channel) {
				return;
			}

			if (data.action === 'ban') {
				await suspendChannel(channel, 'bot_banned');
			} else if (data.action === 'unban') {
				// Der Ban hat Mod- und VIP-Status genommen (Twitch) -> als normaler User zurueck, ohne Mod-Topics
				const suspension = await getSuspension(channel);
				if (suspension?.reason === 'bot_banned' && (suspension.previousMode === 'Moderator' || suspension.previousMode === 'VIP')) {
					await bot.Channels.setData(channel, 'inactive', { ...suspension, previousMode: 'Write' });
				}

				if (await reactivateChannel(channel, bot.Twitch, BOT_BANNED)) {
					console.log(`[channel-suspension] #${channel.name}: Bot entbannt, wieder aktiv`);
				}
			}
		},
	},
});

Object.assign(module.exports, { getFlcChannels });
