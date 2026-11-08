const { defineChatModule } = require('../clients/modules/chat-modules.js');

const { suspendChannel } = require('../services/channel-suspension.js');

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
 * Ein gesperrter Channel, in dem der Bot schon ist, meldet sich nicht zwingend - das uebernimmt der Cron ban-check.
 */
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
	},
});

Object.assign(module.exports, { getFlcChannels });
