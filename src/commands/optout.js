const { getCommand } = require('../clients/modules/commands.js');
const Filter = require('../util/filter.js');

// Supibots commands/optout (mit parseGenericFilterOptions/handleGenericFilter aus Supibots utils/command-utils.ts):
// niemand kann den Command mit dir als Ziel ausfuehren. Ersetzt sb-v2s "lastseen optout" allgemein fuer alle
// Commands mit dem Flag "opt-out" (alexmoderat, 23.10.2026).
module.exports = {
	name: 'optout',
	aliases: ['unoptout'],
	cooldown: 5000,
	description: 'Makes it so you cannot be the target of a command - the command will not be executed at all. For detailed usage, please check the extended help.',
	usage: 'optout <command|all> [channel:name] | unoptout <command|all> | optout id:<ID>',
	flags: ['mention', 'skip-banphrase'],
	params: [
		{ name: 'command', type: 'string' },
		{ name: 'channel', type: 'string' },
		{ name: 'id', type: 'number' },
		{ name: 'invocation', type: 'string' },
		{ name: 'platform', type: 'string' },
	],
	execute: async (client, msg) => {
		const args = [...msg.args];
		const { params, invocation } = msg;
		const isEnable = invocation === 'optout';
		const verb = isEnable ? 'opted out from' : 'removed your opt-out from';

		let filter = null;
		const data = { command: null, invocation: null, channel: null, platform: null };

		if (typeof params.id === 'number') {
			filter = Filter.get(params.id);
			if (!filter) {
				return { success: false, text: `There is no filter with ID ${params.id}!` };
			} else if (filter.Type !== 'Opt-out') {
				return { success: false, text: `Invalid filter type provided! Re-check the filter ID.` };
			}
		} else {
			const commandName = params.command ?? args[0];
			if (!commandName) {
				return { success: false, text: `A command (or "all" to optout globally) must be provided!` };
			}

			if (commandName !== 'all') {
				const commandData = getCommand(commandName);
				if (!commandData) {
					return { success: false, text: `Command ${commandName} does not exist!` };
				} else if (!commandData.Flags.includes('opt-out')) {
					return { success: false, text: 'You cannot opt out from this command!' };
				}

				data.command = commandData.Name;
				// Alias angegeben -> nur dieser Aufruf (Supibots "Heuristik")
				if (commandData.Name !== commandName) {
					data.invocation = commandName;
				}
			}

			if (params.channel && params.platform) {
				return { success: false, text: 'Cannot specify both the channel and platform!' };
			} else if (params.channel) {
				const channelData = bot.Channels.get(params.channel.replace(/^#/, ''), bot.Twitch);
				if (!channelData) {
					return { success: false, text: `Channel ${params.channel} does not exist!` };
				}
				data.channel = channelData.id;
			} else if (params.platform) {
				// Es gibt nur Twitch - ein Filter fuer "twitch" ist derselbe wie ohne Plattform
				if (params.platform.toLowerCase() !== 'twitch') {
					return { success: false, text: `Platform ${params.platform} does not exist!` };
				}
			}

			filter =
				Filter.getLocals('Opt-out', { user: msg.sender, command: data.command, invocation: data.invocation, includeInactive: true }).find(
					(i) => i.User_Alias === msg.sender.id && i.Channel === data.channel && i.Platform === data.platform && i.Command === data.command && i.Invocation === data.invocation,
				) ?? null;
		}

		let result;
		let location = '';
		if (filter) {
			if (filter.Issued_By !== msg.sender.id) {
				return { success: false, text: `You can't edit this filter - you didn't create it!` };
			} else if (filter.Active === isEnable) {
				const state = isEnable ? 'enabled' : 'disabled';
				return {
					success: false,
					text: typeof params.id === 'number' ? `Your filter ID ${params.id} is already ${state}!` : `This combination is already ${state}!`,
				};
			}

			await filter.toggle();
			result = filter;
		} else {
			if (!isEnable) {
				return { success: false, text: `You have not opted out from this combination before, so you can't ${invocation} just yet!` };
			}

			result = await Filter.create({
				Type: 'Opt-out',
				User_Alias: msg.sender.id,
				Issued_By: msg.sender.id,
				Command: data.command,
				Channel: data.channel,
				Platform: data.platform,
				Invocation: data.invocation,
			});

			if (params.channel) {
				location = ` in channel ${params.channel}`;
			} else if (params.platform) {
				location = ` in platform ${params.platform}`;
			}
		}

		const prefix = bot.Config.prefix;
		const commandString =
			result.Command === null
				? 'all valid commands'
				: result.Invocation !== null
					? `command ${prefix}${result.Command} (only applies to alias ${prefix}${result.Invocation})`
					: `command ${prefix}${result.Command}`;

		return { success: true, text: `Successfully ${verb} ${commandString}${location} (ID ${result.ID}).` };
	},
	dynamicDescription: (prefix) => [
		'Opts you out of a specific command. While opted out, nobody can use it with you as the parameter.',
		'',
		`<code>${prefix}optout (command)</code> / <code>${prefix}optout command:randomline</code>`,
		`<code>${prefix}optout rl</code> - only that alias`,
		`<code>${prefix}optout all</code> - all current and future opt-outable commands`,
		`<code>${prefix}optout rl channel:(channel)</code> - only in that channel`,
		`<code>${prefix}unoptout (command)</code> / <code>${prefix}unoptout id:(ID)</code> - reverse it`,
	],
};
