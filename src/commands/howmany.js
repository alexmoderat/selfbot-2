const { getCommand } = require('../commandHandler.js');
const customCommands = require('../util/custom-commands.js');

/**
 * Wie oft ein Command benutzt wurde, im Channel und ueberall (ninou2, 28.10.2026: "the command : !howmany !hm",
 * Antwort "the command !csi has been used in @ninou2 chat : [500 times] , Global use : [610 times]" - woertlich).
 * Gezaehlt werden alle Aufrufe samt Aliasen aus Command_Execution (seit 23.10.2026; sb-v2 hat keine Zahlen gesammelt).
 */
const formatHowMany = (shown, channelName, inChannel, global) => `the command ${shown} has been used in @${channelName} chat : [${inChannel} times] , Global use : [${global} times]`;

const count = async (command, channelId) => {
	return await bot.DB.CommandExecution.countDocuments({ command, ...(channelId !== null ? { channelId } : {}) });
};

const command = {
	name: 'howmany',
	aliases: ['hm'],
	cooldown: { user: 5 },
	access: { channel: 0 },
	description: 'Shows how often a command has been used in this channel and globally.',
	usage: 'howmany <command>',
	execute: async ({ client, message: msg }) => {
		const [input] = msg.args;
		const channel = msg.channelData;
		const display = msg.displayName;
		if (!channel) {
			return { success: false, text: 'This command only works in a channel.' };
		}

		const name = input?.toLowerCase().replace(/^!/, '');
		if (!input || !name) {
			return { success: false, text: `@${display}, Usage: ${msg.prefix}${msg.invocation} <command>` };
		}

		const builtIn = getCommand(name);
		if (builtIn) {
			const [inChannel, global] = await Promise.all([count(builtIn.Name, channel.id), count(builtIn.Name, null)]);
			return formatHowMany(input, channel.name, inChannel, global);
		}

		// Custom Commands gibt es nur in diesem Channel - Name wie in custom-commands.resolve()
		const custom = await customCommands.get(channel, `!${name}`);
		if (custom) {
			const uses = await count(`custom:${channel.id}:${name}`, channel.id);
			return formatHowMany(input, channel.name, uses, uses);
		}

		return { success: false, text: `@${display}, there's no command called ${input}.` };
	},
};

module.exports = { command };

Object.assign(module.exports, { formatHowMany });
