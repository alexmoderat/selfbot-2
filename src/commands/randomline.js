const { commands } = require('../clients/modules/commands.js');

const { randomInt } = require('../misc/command-utils.js');
const { fetchUserTwitchId } = require('../misc/commands/randomline/twitch-id.js');
const Rustlog = require('../misc/commands/randomline/rustlog.js');

// Supibots commands/randomline: aus dem eigenen Zeilen-Log (selfbot_chat_line), fuer Channels ohne Zeilen-Log
// ueber Rustlog-kompatible Dienste (eigener justlog, dann IVR). "rq" waehlt nur aus den eigenen Zeilen.

const fetchUserRandomLine = async (userData, channelData) => {
	const table = channelData.getDatabaseName();
	const count = await core.Query.getRecordset((rs) =>
		rs // TODO(port)
			.select('Message_Count AS Count')
			.from('selfbot_data', 'Message_Meta_User_Alias')
			.where('User_Alias = %n', userData.id)
			.where('Channel = %n', channelData.id)
			.single()
			.flat('Count'),
	);

	if (!count || !userData.twitchId || !(await core.Query.isTablePresent('selfbot_chat_line', table))) {
		// TODO(port)
		return { success: false, text: 'That user has not posted any messages in this channel!' };
	}

	const line = await core.Query.getRecordset((rs) =>
		rs // TODO(port)
			.select('Text', 'Posted')
			.from('selfbot_chat_line', table)
			.where('Platform_ID = %s', userData.twitchId)
			.limit(1)
			.offset(randomInt(1, count) - 1)
			.single(),
	);

	// Meta zaehlt auch Nachrichten, die noch nicht geschrieben sind -> Offset kann ins Leere zeigen
	if (!line) {
		return { success: false, text: 'No chat lines found for this user!' };
	}

	return { success: true, text: line.Text, date: line.Posted, username: userData.name };
};

const fetchChannelRandomLine = async (channelData) => {
	const table = channelData.getDatabaseName();
	const max = (await core.Query.isTablePresent('selfbot_chat_line', table)) // TODO(port)
		? await core.Query.getRecordset((rs) => rs.select('MAX(ID) AS Total').from('selfbot_chat_line', table).single().flat('Total')) // TODO(port)
		: undefined;

	if (!max) {
		return { success: false, text: 'This channel does not have enough chat lines saved just yet! Try again in a minute or so.' };
	}

	const line = await core.Query.getRecordset((rs) =>
		rs // TODO(port)
			.select('Text', 'Posted', 'Platform_ID')
			.from('selfbot_chat_line', table)
			.where('ID >= %n', randomInt(1, Number(max)))
			.orderBy('ID ASC')
			.limit(1)
			.single(),
	);

	if (!line) {
		return { success: false, text: 'No chat lines found for this user!' };
	}

	const user = await bot.Users.getByTwitchId(line.Platform_ID);
	return { success: true, text: line.Text, date: line.Posted, username: user?.name ?? `(${line.Platform_ID})` };
};

module.exports = {
	name: 'randomline',
	aliases: ['rl', 'rq'],
	cooldown: 15000,
	description:
		'Fetches a random line from the current channel. If a user is specified, fetches a random line from that user only. "rq" only chooses from your own lines.',
	usage: 'randomline [user] [textOnly:true] [userID:id]',
	flags: ['block', 'external-input', 'opt-out', 'pipe'],
	params: [
		{ name: 'textOnly', type: 'boolean' },
		{ name: 'userID', type: 'string' },
	],
	execute: async (client, msg) => {
		const [user] = msg.args;
		const channel = msg.channelData;
		if (!channel) {
			return { success: false, text: 'This command cannot be used in private messages!' };
		}

		const target = msg.invocation === 'rq' ? msg.sender.name : user;
		let result;

		if (!channel.Logging.has('Lines')) {
			const channelID = channel.twitchId;
			if (!channelID || !(await Rustlog.isChannelSupported(channelID))) {
				return {
					success: false,
					text: 'Random lines are not available in this channel! The logger (logchannel add) or the IVR Rustlog service has to track it first.',
				};
			}

			if (target) {
				const userID = await fetchUserTwitchId(target);
				if (!userID) {
					return { success: false, text: `That user does not exist!` };
				}

				result = await Rustlog.fetchRandomUserLine(channelID, userID);
			} else if (msg.params.userID) {
				result = await Rustlog.fetchRandomUserLine(channelID, msg.params.userID);
			} else {
				result = await Rustlog.fetchRandomChannelLine(channelID);
			}
		} else if (target) {
			const targetUser = await bot.Users.get(target);
			if (!targetUser) {
				return { success: false, text: 'I have not seen that user before, so you cannot check their random lines!' };
			} else if (msg.params.userID) {
				return { success: false, text: 'Cannot fetch logs by user ID in this channel!' };
			}

			result = await fetchUserRandomLine(targetUser, channel);
		} else {
			result = await fetchChannelRandomLine(channel);
		}

		if (!result.success) {
			return result;
		} else if (msg.params.textOnly) {
			return { success: true, text: result.text };
		}

		return { success: true, text: `(${bot.Utils.timeDelta(result.date)}) ${result.username}: ${result.text}` };
	},
	dynamicDescription: (prefix) => [
		'Fetches a random chat line from the current channel. If you specify a user, the line will be from that user only.',
		'',
		`<code>${prefix}rl</code> - random message from anyone, "(time ago) (username): (message)"`,
		`<code>${prefix}rl (user)</code> - random message from that user only`,
		`<code>${prefix}rq</code> - random message from yourself only`,
		`<code>${prefix}rl (user) textOnly:true</code> - only the message`,
		`<code>${prefix}rl userID:(user id)</code> - by user ID (channels logged by an external service only)`,
	],
};
