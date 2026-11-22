const Filter = require('../util/filter.js');
const { chatLogger } = require('../util/chat-logger.js');

// Supibots commands/lastseen (ohne Channel-Namen - genau der Datenschutz-Punkt, wegen dem sb-v2 ein optout brauchte).
// "lastseen optout" / "lastseen optin" aus sb-v2 bleiben als Kurzform fuer Supibots "optout lastseen" / "unoptout lastseen".
const command = {
	name: 'lastseen',
	aliases: ['ls'],
	cooldown: { user: 5 },
	access: { channel: 0 },
	description: 'For a given user, this command tells you when they were last seen - based on their chat activity.',
	usage: 'lastseen <user> | lastseen optout | lastseen optin',
	flags: ['block', 'mention', 'opt-out', 'pipe'],
	execute: async ({ client, message: msg }) => {
		const [user] = msg.args;
		const sub = user?.toLowerCase();
		if (sub === 'optout' || sub === 'optin') {
			const existing = Filter.getLocals('Opt-out', { user: msg.sender, command: command.name, includeInactive: true }).find(
				(i) => i.User_Alias === msg.sender.id && i.Command === command.name && i.Channel === null && i.Platform === null && i.Invocation === null,
			);

			if (sub === 'optout') {
				if (existing?.Active) {
					return { success: false, text: "You're already opted out from lastseen." };
				} else if (existing) {
					await existing.toggle();
				} else {
					await Filter.create({ Type: 'Opt-out', User_Alias: msg.sender.id, Command: command.name, Issued_By: msg.sender.id });
				}

				return "You're opted out — lastseen will no longer work for your name.";
			}

			if (!existing?.Active) {
				return { success: false, text: "You weren't opted out." };
			}

			await existing.toggle();
			return "You're opted back in.";
		}

		if (!user) {
			const emote = await msg.getBestAvailableEmote(['FeelsDankMan'], '🙂');
			return { success: false, text: `${emote} You were last seen: right now!` };
		}

		const targetUser = await bot.Users.get(user);
		if (!targetUser) {
			return { success: false, text: 'I have not seen that user before!' };
		} else if (targetUser.id === msg.sender.id && msg.channelData) {
			const emote = await msg.getBestAvailableEmote(['PepeLaugh', 'pepeLaugh', 'LULW', 'LuL'], '😆');
			return { success: false, text: `Oh wow, look at that! You were last seen: Right now! ${emote}` };
		} else if (targetUser.name === bot.Twitch.selfName) {
			const emote = await msg.getBestAvailableEmote(['monkaStare', 'MrDestructoid'], '🤖');
			return { success: false, text: `${emote} I'm always around!` };
		}

		let date = chatLogger.getUserLastSeen(targetUser.id);
		if (!date) {
			date = (await bot.DB.MessageMetaUserAlias.findOne({ userAlias: targetUser.id }, { lastMessagePosted: 1 }).sort({ lastMessagePosted: -1 }).lean())?.lastMessagePosted ?? null;

			if (!date) {
				return {
					success: true,
					text: `I have seen this user appear, but they never showed up in chat. They were first spotted ${bot.Utils.timeDelta(targetUser.Started_Using)}.`,
				};
			}
		}

		const who = msg.sender === targetUser ? 'You were' : 'That user was';
		return { success: true, text: `${who} last seen in chat ${bot.Utils.timeDelta(date)}.` };
	},
};

module.exports = { command };
