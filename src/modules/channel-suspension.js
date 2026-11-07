const { defineChatModule } = require('../clients/modules/chat-modules.js');

const { banUser } = require('../services/moderation.js');
const { suspendChannel } = require('../services/channel-suspension.js');

/**
 * Wertet Meldungen zum Zustand eines Channels aus, aus sb-v2 (dort IRC-NOTICEs). Ohne IRC kommen sie hier als
 * "channelState": msg_channel_suspended aus einem widerrufenen EventSub-Abo (user_removed), die anderen als
 * Drop-Grund beim Senden ueber Helix.
 *   msg_channel_suspended   Account gesperrt/geloescht -> Channel still verlassen (ban-check holt ihn zurueck)
 *   msg_channel_restricted  Feature-Sperre (FLC) -> drinbleiben, nur melden
 *   msg_suspended_channel   dito
 *   msg_banned              Bot selbst gebannt -> Channel-Owner im eigenen Channel bannen
 * Ein gesperrter Channel, in dem der Bot schon ist, meldet sich nicht zwingend - das uebernimmt der Cron ban-check.
 */
const flcChannels = new Map();
const selfBannedChannels = new Map();

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
			} else if (msgId !== 'msg_banned') {
				console.log(`[channel-suspension] #${channel.name}: ${msgId} - "${text}"`);
				return;
			}

			// Bot selbst gebannt -> Channel-Owner im eigenen Channel bannen (einmal je Laufzeit)
			if (!selfBannedChannels.has(channel.id) && channel.twitchId) {
				console.warn(`[channel-suspension] Bot ist in #${channel.name} gebannt`);
				const ok = await banUser(
					{
						channelName: platform.selfName.toLowerCase(),
						broadcasterId: platform.selfId,
						userId: channel.twitchId,
						userName: channel.name,
					},
					{ reason: 'Bot was banned from their channel', status: 'SELF_BANNED' },
				);

				console.warn(`[channel-suspension] Auto-Ban ${channel.name} in #${platform.selfName}: ${ok ? 'ok' : 'fehlgeschlagen'}`);
			}

			selfBannedChannels.set(channel.id, Date.now());
		},
	},
});

Object.assign(module.exports, { getFlcChannels });
