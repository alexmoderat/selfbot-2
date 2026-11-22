const { Logger } = require('../../../misc/logger.js');
const { defineChatModule } = require('../chat-modules.js');
const triggers = require('../../../util/trigger-commands.js');
const { rolesFromBadges } = require('../../../util/text-analysis.js');

/**
 * Fuehrt Trigger-Commands aus, aus sb-v2: Reihenfolge Muster, Whitelist, mod_only, online/offline, Cooldown;
 * es feuert nur der erste Treffer. Platzhalter {user}, {channel}, {message} ({message} spiegelt den getippten Text,
 * z. B. fuer ein "!play"-Echo - Holger_Gilruth, 13.08.2026).
 * Der Bot laeuft auf alexmoderats Account, deshalb keine Pauschal-Sperre fuer dessen Nachrichten - nur die gerade
 * gesendete eigene Trigger-Antwort wird kurz ignoriert, damit ein Echo-Trigger sich nicht selbst ausloest
 * (alexmoderat, 13.10.2026).
 */
const SELF_ECHO_WINDOW = 3000;
const recentlySent = new Map();

const formatTriggerResponse = (response, userName, channelName, message) =>
	response
		.replaceAll(/\{user\}/gi, `@${userName}`)
		.replaceAll(/\{channel\}/gi, channelName)
		.replaceAll(/\{message\}/gi, message);

module.exports = defineChatModule({
	name: 'trigger-commands',
	description: 'Replies to configured patterns in chat.',
	scope: 'global',
	handlers: {
		message: async (context) => {
			const { channel, user, message, messageId, data, platform } = context;
			const echoKey = `${channel.id}::${message}`;
			const sentAt = recentlySent.get(echoKey);
			if (sentAt && Date.now() - sentAt < SELF_ECHO_WINDOW) {
				return;
			} else if (!bot.Channels.isWritable(channel)) {
				return;
			}

			const rows = await triggers.getForChannel(channel);
			for (const row of rows) {
				let regex;
				try {
					regex = new RegExp(row.Pattern, 'i');
				} catch {
					continue; // defektes Muster ueberspringen
				}

				if (!regex.test(message)) {
					continue;
				}

				const whitelist = triggers.parseWhitelist(row.Whitelist);
				if (whitelist.length > 0 && !whitelist.includes(user.twitchId ?? '')) {
					continue;
				}

				const roles = rolesFromBadges(user.name, data.badges);
				if (row.Mod_Only && !(roles.isMod || roles.isBroadcaster)) {
					continue;
				}

				if (row.Online_Only || row.Offline_Only) {
					const live = await bot.Channels.isLive(channel);
					if ((row.Online_Only && live === false) || (row.Offline_Only && live === true)) {
						continue;
					}
				}

				// global: ein Cooldown fuer alle - sonst feuert ein Trigger, den viele kurz nacheinander ausloesen, in Serie
				const cooldownKey = row.Global_Cooldown ? '*' : (user.twitchId ?? user.name);
				if (triggers.onCooldown(channel.id, row.ID, cooldownKey, row.Cooldown)) {
					continue;
				}

				Logger.info(`[trigger-commands] Treffer "${row.Pattern}" von ${user.name} in #${channel.name}`);
				const response = formatTriggerResponse(row.Response, user.name, channel.name, message);
				// Vor dem Senden merken: das Echo der eigenen Nachricht kann eintreffen, bevor send() zurueckkehrt, und
				// loeste den Trigger sonst ein zweites Mal aus (alexmoderat, 12.11.2026: "hi" in #kickster1010 doppelt)
				const sentKey = `${channel.id}::${response}`;
				recentlySent.set(sentKey, Date.now());
				if (recentlySent.size > 500) {
					recentlySent.clear();
				}
				await platform.send(response, channel, { replyTo: row.Reply ? messageId : null }).catch(() => recentlySent.delete(sentKey));
				break;
			}
		},
	},
});

Object.assign(module.exports, { formatTriggerResponse });
