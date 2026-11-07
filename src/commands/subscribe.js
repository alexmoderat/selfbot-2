const { listOrLink } = require('../misc/list-reply.js');

/**
 * Supibots commands/subscribe mit dem Ereignis "Channel live" (event-types/channel-live.ts): Whisper, wenn ein Channel
 * mit dem Bot live geht (Zustellung: chat-modules/live-detection). alexmoderat, 24.10.2026: "Beides" - sb-v2s notify
 * live bleibt daneben. Supibots weitere Ereignisse (Suggestion, Changelog, OSRS, YouTube, ...) sind nicht portiert.
 */
const CHANNEL_LIVE_SUBSCRIPTION_TITLE = 'Channel live';

const EVENTS = [{ title: CHANNEL_LIVE_SUBSCRIPTION_TITLE, names: ['live', 'online'] }];

module.exports = {
	name: 'subscribe',
	aliases: ['unsubscribe'],
	cooldown: 5000,
	description: 'Subscribe or unsubscribe to events, such as a channel going live. Check the extended help for detailed info on each event.',
	usage: 'subscribe live (channels...) | unsubscribe live (channels...)',
	flags: ['mention', 'pipe'],
	execute: async (client, msg) => {
		const [type, ...args] = msg.args;
		if (!type) {
			return {
				success: false,
				text: "No event provided! Check the command's extended help for a list.",
			};
		}

		const event = EVENTS.find((i) => i.names.includes(type.toLowerCase()));
		if (!event) {
			return {
				success: false,
				text: "Incorrect event provided! Check the extended command's help for a list.",
			};
		}

		const { invocation } = msg;
		const existing = bot.DB.toRow('EventSubscription', await bot.DB.EventSubscription.findOne({ userAlias: msg.sender.id, type: event.title }).lean());

		if (!existing && invocation === 'unsubscribe') {
			return {
				success: false,
				text: "You're not subscribed yet, and can't unsubscribe!",
			};
		}

		const data = JSON.parse(existing?.Data ?? '{}');
		data.channels = data.channels ?? [];

		const channels = args
			.map((i) => bot.Channels.get(i.toLowerCase().replace(/^[@#]/, '')))
			.filter((i) => i !== null && i.Mode !== 'Inactive')
			.map((i) => i.ID);

		const save = async (values) => {
			// values mit Spaltennamen ({ Active, Data })
			const fields = { ...bot.DB.fromRow('EventSubscription', values), lastEdit: new Date() };
			if (existing) {
				await bot.DB.EventSubscription.updateOne({ _id: existing.ID }, { $set: fields });
			} else {
				await bot.DB.createWithId('EventSubscription', {
					userAlias: msg.sender.id,
					channel: null,
					platform: bot.Twitch.ID,
					type: event.title,
					created: new Date(),
					...fields,
				});
			}
		};

		if (channels.length === 0) {
			if (invocation === 'unsubscribe') {
				await save({ Active: false, Data: null });
				return {
					success: true,
					text: 'Successfully unsubscribed from all channels going live.',
				};
			} else if (args.length === 0) {
				const channelList = data.channels.map((i) => bot.Channels.get(i)?.Name ?? '').filter(Boolean);
				return {
					success: true,
					text:
						data.channels.length === 0
							? "You're not subscribed to any channels."
							: `You're subscribed to these ${data.channels.length} channels: ${await listOrLink(channelList, 'Live subscriptions')}`,
				};
			} else {
				return {
					success: false,
					text: 'No proper channels provided! You can only subscribe to channels with the bot.',
				};
			}
		}

		let response;
		const lengthBefore = data.channels.length;
		if (invocation === 'subscribe') {
			data.channels = [...new Set([...data.channels, ...channels])];
			response =
				data.channels.length > lengthBefore
					? `Successfully subscribed to ${data.channels.length - lengthBefore} channels going live.`
					: 'You did not subscribe to any new channels.';
		} else {
			data.channels = data.channels.filter((i) => !channels.includes(i));
			response =
				data.channels.length < lengthBefore
					? `Successfully unsubscribed from ${lengthBefore - data.channels.length} channels going live.`
					: 'You did not unsubscribe from any channels.';
		}

		await save({ Active: data.channels.length !== 0, Data: JSON.stringify(data, null, 4) });
		return {
			success: true,
			text: response,
		};
	},
	dynamicDescription: (prefix) => [
		"Subscribes or unsubscribes your account from an event in the bot's database.",
		'',
		`<code>${prefix}subscribe live (channel) (channel2) ...</code>`,
		'When one of these channels (it must have the bot in it) goes live, you will be notified via a whisper.',
		'',
		`<code>${prefix}subscribe live</code>`,
		"Lists the channels you're subscribed to.",
		'',
		`<code>${prefix}unsubscribe live (channel)</code> / <code>${prefix}unsubscribe live</code>`,
		'Unsubscribes from the given channels, or from all of them.',
	],
};

Object.assign(module.exports, { CHANNEL_LIVE_SUBSCRIPTION_TITLE });
