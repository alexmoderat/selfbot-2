const { client } = require('../../util/twitch/connections.js');
const { Logger, LogLevel } = require('../../misc/logger.js');
const { invisChars } = require('../../misc/regex.js');
const { toBadgeList, stripReplyMention, MODERATOR_BADGES } = require('../../util/twitch/utils.js');
const { handler } = require('../modules/handler.js');
const Users = require('../../services/users.js');
const AFK = require('../../services/afk.js');
const Reminders = require('../../services/reminders.js');
const ChatModules = require('../modules/chat-modules.js');

// Wie DontAddThisBot: client.on('PRIVMSG') baut msgData mit send() und gibt sie an den Handler.
// Davor wie bisher: Doppel-Erkennung, Channel-/User-Datensatz, AFK-Rueckkehr und wartende Reminder.

const seenMessages = new Map();

/** Twitch liefert bei Wiederholungen dieselbe Message-ID; true = schon gesehen */
const isDuplicate = (messageId, now = Date.now()) => {
	for (const [id, time] of seenMessages) {
		if (now - time <= bot.Config.dedupeWindow) {
			break; // Map ist nach Einfuegezeit sortiert
		}
		seenMessages.delete(id);
	}
	if (seenMessages.has(messageId)) {
		return true;
	}
	seenMessages.set(messageId, now);
	return false;
};

const buildMsgData = (msg, channel) => {
	const badges = toBadgeList(msg.badges, msg.badgeInfo);
	const isMod = msg.isMod || badges.some((i) => MODERATOR_BADGES.has(i.set_id));
	const replyParentId = msg.replyParentMessageID ?? null;

	return {
		user: {
			id: msg.senderUserID,
			name: msg.displayName,
			login: msg.senderUsername,
			display: msg.displayName,
			colorRaw: msg.colorRaw,
			color: msg.color,
			badgesRaw: msg.badgesRaw,
			badges,
			perms: { mod: isMod, broadcaster: msg.badges.hasBroadcaster, vip: msg.badges.hasVIP },
		},
		channel: { id: msg.channelID, login: msg.channelName },
		id: msg.messageID,
		isAction: msg.isAction,
		raw: msg.rawSource,
		originalText: msg.messageText,
		// Fuer die Command-Erkennung: ohne fuehrendes "@parent" bei Antworten und ohne unsichtbare Zeichen
		text: stripReplyMention(msg.messageText, Boolean(replyParentId)).replace(invisChars, '').trim(),
		timestamp: msg.serverTimestampRaw,
		emotes: msg.emotes,
		tags: msg.ircTags,
		replyParentId,
		firstMessage: msg.ircTags['first-msg'] === '1',

		// Eigener Datensatz (Channel, User) wie DontAddThisBots msg.mongoChannel / msg.sender
		channelData: channel,
		sender: null,
		debug: false,
		privateMessage: false,

		get displayName() {
			return this.user.display || this.user.login;
		},

		send: async function (message, reply = false) {
			try {
				await bot.Twitch.send(message, this.channelData, { replyTo: reply ? this.id : null });
			} catch (err) {
				Logger.log(LogLevel.ERROR, `Error while sending message: ${err.message}`);
			}
		},

		whisper: async function (message) {
			await bot.Twitch.whisper(this.sender, message);
		},
	};
};

const onMessage = async (msg) => {
	// Shared Chat: dieselbe Nachricht kommt in allen beteiligten Channels an - nur am Ursprung verarbeiten
	const source = msg.ircTags['source-room-id'];
	if (source && source !== msg.channelID) {
		return;
	}
	if (isDuplicate(msg.messageID)) {
		return;
	}

	const channel = bot.Channels.getByTwitchId(msg.channelID);
	if (!channel || channel.mode === 'Inactive') {
		return;
	}
	if (channel.name !== msg.channelName) {
		await bot.Channels.saveProperty(channel, 'Name', msg.channelName);
	}

	const msgData = buildMsgData(msg, channel);
	msgData.sender = await Users.getOrCreate(msg.senderUsername, { twitchId: msg.senderUserID });

	// Wie Supibot: vor dem Command AFK-Rueckkehr und wartende Reminder - die Nachricht, die gerade einen
	// AFK-Status setzt, beendet ihn so nicht gleich wieder
	// Parallelbetrieb: der alte selfbot sagt AFK-Rueckkehr und Reminder schon an (gleiche Daten nach der Migration)
	if (!bot.Config.parallelMode) {
		await Promise.all([AFK.checkActive(msgData.sender, channel, msgData.displayName), Reminders.checkActive(msgData.sender, channel, msgData.displayName)]);
	}

	const isCommand = await handler(msgData);

	// Form wie bisher (TwitchMessageData), damit die portierten Chat-Module gleich lesen
	ChatModules.dispatch('message', {
		channel,
		user: msgData.sender,
		message: msgData.text,
		messageId: msgData.id,
		data: {
			messageId: msgData.id,
			displayName: msgData.displayName,
			badges: msgData.user.badges,
			color: msgData.user.colorRaw || null,
			replyParentMessageId: msgData.replyParentId,
			messageType: msgData.isAction ? 'action' : 'text',
			isFirstMessage: msgData.firstMessage,
		},
		msg: msgData,
		isCommand,
	});
};

const PRIVMSG = async function () {
	client.on('PRIVMSG', (msg) => {
		onMessage(msg).catch((e) => Logger.log(LogLevel.ERROR, '[PRIVMSG] Nachricht nicht verarbeitet', e));
	});
};

module.exports = { PRIVMSG, buildMsgData, isDuplicate };
