const { fetchUserEmotes } = require('../misc/twitch-lists.js');

// Supibots commands/botsubs: gesubbte Channels aus den Sub-Emotes des Bot-Accounts, je ein Beispiel-Emote.
// Ersetzt sb-v2s botsubs (nur Zahl per GQL) und subinfo (alle Emotes) - alexmoderat, 23.10.2026:
// "Nimm Supibots botsubs, subinfo aus sb-v2 faellt dann weg."
module.exports = {
	name: 'botsubs',
	cooldown: 10000,
	description: 'Posts the channels the bot is currently subscribed to on Twitch, along with a sample sub emote to each.',
	usage: 'botsubs [channelsOnly:true] [emotesOnly:true]',
	flags: ['pipe'],
	params: [
		{ name: 'channel', type: 'string' },
		{ name: 'channelsOnly', type: 'boolean' },
		{ name: 'emotesOnly', type: 'boolean' },
	],
	execute: async (client, msg) => {
		const twitch = bot.Twitch;
		const emotes = await fetchUserEmotes(twitch.selfId);

		const subEmotes = emotes.filter((i) => i.emote_type === 'subscriptions' && i.owner_id);
		const subChannels = new Set(subEmotes.map((i) => i.owner_id));

		const result = [];
		for (const channel of subChannels) {
			const channelEmotes = subEmotes.filter((i) => i.owner_id === channel);
			result.push(bot.Utils.randArray(channelEmotes));
		}

		result.sort((a, b) => a.owner_id.localeCompare(b.owner_id));

		const channels = result.map((i) => i.owner_id);
		const channelNames = channels.map((i) => bot.Channels.getByTwitchId(i)?.Name ?? null).filter(Boolean);
		if (msg.params.channelsOnly) {
			return {
				text: channelNames.join(', '),
			};
		}

		const emoteString = result.map((i) => i.name).join(' ');
		if (msg.params.emotesOnly) {
			return {
				text: emoteString,
			};
		}

		let message = `I am currently subscribed to: ${channelNames.join(' ')} - ${emoteString}`;
		if (message.length > bot.Twitch.Message_Limit) {
			message = `${result.length} channels: ${emoteString}`;
		}

		return {
			text: message,
		};
	},
	dynamicDescription: (prefix) => [
		'Fetches a list of all channels the bot is currently subscribed to, along with a sample of their emotes.',
		'If the list is too long, the channel names are omitted, and only the emotes are posted.',
		'',
		`<code>${prefix}botsubs</code>`,
		'Simple list of channels + emotes, or just emotes if there are too many subscriptions.',
		'',
		`<code>${prefix}botsubs channelsOnly:true</code>`,
		'Posts all channels the bot is subscribed to, omitting the random emote samples.',
		'',
		`<code>${prefix}botsubs emotesOnly:true</code>`,
		'Only posts random emote samples, 1 per each channel, without any other text.',
	],
};
