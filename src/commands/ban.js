const { getCommand } = require('../commandHandler.js');
const { SupiError } = require('../util/error.js');
const Filter = require('../util/filter.js');
const { isArgumentsData } = Filter;

// Supibots commands/ban - ersetzt sb-v2s disablecmd/enablecmd/listdisabled (alexmoderat, 23.10.2026: "Supibot ban/Filter").
// Supibot erlaubt das Channel-Ownern und Ambassadors; Ambassadors gibt es im selfbot nicht -> Administratoren ueberall,
// Channel-Owner in ihrem Channel.

const AVAILABLE_BAN_FILTER_TYPES = ['Arguments', 'Blacklist', 'Cooldown', 'Online-only', 'Offline-only', 'Reminder-prevention'];
const NO_RESPONSE_FILTER_TYPES = new Set(['Arguments', 'Blacklist', 'Online-only', 'Offline-only']);

// Zurueck in die Datenbank-Form. Bereiche als "a..b"-Text: JSON.stringify macht aus Infinity sonst null
const toDatabaseItems = (items) =>
	items.map((i) => ({
		...(typeof i.string === 'string' ? { string: i.string } : { regex: i.regex ? `/${i.regex.source}/${i.regex.flags}` : undefined }),
		...(typeof i.index === 'number' ? { index: i.index } : { range: i.range ? `${i.range[0]}..${i.range[1]}` : undefined }),
	}));

const isFilterType = (input) => AVAILABLE_BAN_FILTER_TYPES.includes(input);
const capitalize = (input) =>
	input
		.split('-')
		.map((i) => i.charAt(0).toUpperCase() + i.slice(1).toLowerCase())
		.join('-');

module.exports = {
	name: 'ban',
	aliases: ['unban'],
	cooldown: 5000,
	description: 'Bans/unbans any combination of channel, user, and command from being executed. Only usable by channel owners and bot administrators.',
	usage: 'ban [command:name] [user:name] [invocation:alias] [channel:name] [type:blacklist|offline-only|online-only|cooldown|arguments|reminder-prevention]',
	flags: ['mention'],
	params: [
		{ name: 'all', type: 'boolean' },
		{ name: 'channel', type: 'string' },
		{ name: 'clear', type: 'boolean' },
		{ name: 'command', type: 'string' },
		{ name: 'index', type: 'number' },
		{ name: 'invocation', type: 'string' },
		{ name: 'multiplier', type: 'number' },
		{ name: 'noResponse', type: 'boolean' },
		{ name: 'type', type: 'string' },
		{ name: 'string', type: 'string' },
		{ name: 'user', type: 'string' },
	],
	execute: async (client, msg) => {
		const { invocation } = msg;
		const type = capitalize(msg.params.type ?? 'Blacklist');
		if (!isFilterType(type)) {
			return {
				success: false,
				text: `Invalid ban filter type provided! Use one of ${AVAILABLE_BAN_FILTER_TYPES.join(', ')}`,
			};
		}

		const options = {
			Channel: null,
			User_Alias: null,
			Command: null,
			Invocation: null,
			Type: type,
			Response: 'None',
			Reason: null,
			Issued_By: msg.sender.id,
		};

		const isAdmin = (await bot.Users.getData(msg.sender, 'administrator')) === true;
		if (msg.params.channel) {
			if (isAdmin && msg.params.channel === 'global') {
				options.Channel = null;
			} else {
				const channelData = bot.Channels.get(msg.params.channel.replace(/^#/, ''), bot.Twitch);
				if (!channelData) {
					return { success: false, text: 'Channel was not found!' };
				}

				options.Channel = channelData.id;
			}
		}
		if (msg.params.command) {
			const commandData = getCommand(msg.params.command);
			if (!commandData) {
				return { success: false, text: 'Command does not exist!' };
			} else if (commandData === this) {
				const emote = await msg.getBestAvailableEmote(['PepeLaugh', 'pepeLaugh', '4Head'], '😅');
				return { success: false, text: `You can't ${invocation} the ${commandData.Name} command! ${emote}` };
			}

			options.Command = commandData.Name;
		}
		if (msg.params.invocation) {
			const commandData = getCommand(msg.params.invocation);
			if (!commandData) {
				return { success: false, text: 'No command found for given invocation!' };
			} else if (commandData === this) {
				const emote = await msg.getBestAvailableEmote(['PepeLaugh', 'pepeLaugh', '4Head'], '😅');
				return { success: false, text: `You can't ${invocation} the ${commandData.Name} command's invocation! ${emote}` };
			}

			if (!options.Command) {
				options.Command = commandData.Name;
			} else if (options.Command !== commandData.Name) {
				return {
					success: false,
					text: 'Invalid command + invocation provided! Either keep command: empty, or use the command that belongs to the provided invocation',
				};
			}

			options.Invocation = msg.params.invocation;
		}
		if (msg.params.user) {
			const userData = await bot.Users.get(msg.params.user);
			if (!userData) {
				return { success: false, text: 'User was not found!' };
			} else if (userData === msg.sender) {
				return { success: false, text: `You can't ${invocation} yourself!` };
			} else if (userData.name === bot.Twitch.selfName) {
				return { success: false, text: `You can't do that!` };
			}

			options.User_Alias = userData.id;
		}

		if (!options.Channel && !isAdmin) {
			if (!msg.channelData) {
				return {
					success: false,
					text: `When using this command in private messages, you must provide a channel with the "channel:(name)" parameter!`,
				};
			}

			options.Channel = msg.channelData.id;
		}

		if (options.Channel && !isAdmin) {
			const channelData = bot.Channels.get(options.Channel);
			const isOwner = Boolean(channelData && channelData.Platform.isUserChannelOwner(channelData, msg.sender));
			if (!isOwner) {
				return { success: false, text: "Can't do that in this channel!" };
			} else if (!options.User_Alias && !options.Command) {
				return { success: false, text: 'Not enough data provided to create a ban! You are missing user and/or command' };
			}

			if (msg.params.noResponse) {
				if (!NO_RESPONSE_FILTER_TYPES.has(type)) {
					return { success: false, text: `Cannot create a no-response ban of type ${type}!` };
				}

				options.Response = 'None';
				options.Reason = null;
			} else {
				options.Response = 'Auto';
				options.Reason = null;
			}
		}

		if (!options.User_Alias && !options.Command && !options.Channel && isAdmin) {
			return { success: false, text: 'Not enough data provided to create a ban! You are missing all identifiers.' };
		} else if (type === 'Reminder-prevention' && (!options.Channel || !options.User_Alias || options.Command || options.Invocation)) {
			return { success: false, text: `You must provide the channel and a user (no other params) to create a reminder prevention!` };
		}

		const channelData = options.Channel ? bot.Channels.get(options.Channel) : null;
		const userData = options.User_Alias ? await bot.Users.get(options.User_Alias) : null;

		const filterResult = Filter.getLocals(type, {
			channel: channelData,
			user: userData,
			command: options.Command,
			invocation: options.Invocation,
			includeInactive: true,
		}).filter((i) => i.Channel === (channelData?.id ?? null) && i.User_Alias === (userData?.id ?? null) && i.Command === options.Command);

		if (filterResult.length !== 0) {
			const [existing] = filterResult;

			let appendix = '';
			if (existing.Issued_By !== null && existing.Issued_By !== msg.sender.id) {
				const issuerUser = await bot.Users.get(existing.Issued_By);
				if (!issuerUser) {
					throw new SupiError({ message: 'Assert error: Issuer user does not exist' });
				}

				// Supibot vergleicht Rechte-Stufen: einen Filter eines Administrators darf nur ein Administrator aendern
				const issuerIsAdmin = (await bot.Users.getData(issuerUser, 'administrator')) === true;
				if (issuerIsAdmin && !isAdmin) {
					return {
						success: false,
						text: `This filter has been created by user with level administrator, which is higher than yours, so you cannot modify it!`,
					};
				}

				appendix = ` (this filter has been created by @${issuerUser.name})`;
			}

			if (type === 'Arguments') {
				if (!existing.Data || !isArgumentsData(existing.Data)) {
					throw new SupiError({ message: `Invalid filter definition - invalid Arguments data` });
				}

				const { clear = false, index, string } = msg.params;
				if (invocation === 'ban') {
					if (!existing.Active) {
						await existing.toggle();
					}

					const newData = toDatabaseItems(existing.Data);
					for (const item of existing.Data) {
						if (item.index === index && item.string === string) {
							return { success: false, text: `This combination of index and string in an Arguments filter is already banned!` };
						}
					}

					if (typeof string === 'string') {
						let changed = false;
						if (msg.params.all === true) {
							changed = true;
							newData.push({ range: '0..Infinity', string });
						} else if (typeof index === 'number' && Number.isInteger(index)) {
							changed = true;
							newData.push({ index, string });
						}

						if (changed) {
							const shape = { args: newData };
							await existing.saveData(JSON.stringify(shape));
							return { success: true, text: `Successfully added a new item to Arguments filter (ID ${existing.ID})` };
						}
					}

					return { success: false, text: `Invalid combination of parameters for the Argument type provided!` };
				}

				if ((Number.isInteger(index) || msg.params.all === true) && typeof string === 'string') {
					const items = [...existing.Data];
					for (let i = 0; i < items.length; i++) {
						const item = items[i];
						const condition = msg.params.all === true ? Boolean(item.range && item.range[0] === 0 && item.range[1] === Infinity) : item.index === index;

						if (condition && item.string === string) {
							items.splice(i, 1);
							const shape = { args: toDatabaseItems(items) };

							await existing.saveData(JSON.stringify(shape));
							return { success: true, text: `Successfully removed an item from the Arguments filter (ID ${existing.ID})` };
						}
					}

					return { success: false, text: `No matching items found in the Arguments filter!` };
				} else if (clear) {
					const emptyShape = { args: [] };
					await existing.saveData(JSON.stringify(emptyShape));
					return { success: true, text: `Successfully cleared all items from the Arguments filter (ID ${existing.ID})` };
				} else if (existing.Active) {
					await existing.toggle();
					return {
						success: false,
						text: `Successfully disabled Arguments filter (ID ${existing.ID}). Its items are still available, it just isn't active.`,
					};
				}

				return { success: false, text: `Invalid combination of parameters for the Argument type provided!` };
			} else if (type === 'Cooldown') {
				const { multiplier } = msg.params;
				if (invocation === 'ban') {
					if (!existing.Active) {
						await existing.toggle();
					}

					if (typeof multiplier !== 'number') {
						return { success: false, text: `No multiplier provided! Use multiplier:(number) to set it.` };
					} else if (multiplier < 1 || multiplier >= 1e6) {
						return { success: false, text: `Invalid multiplier provided! Must be in range between <1, 1 000 000>.` };
					}

					await existing.saveData(JSON.stringify({ multiplier }));
					return { success: true, text: `Successfully updated the cooldown filter!` };
				}

				await existing.toggle();
				return { success: false, text: `Successfully disabled Cooldown filter (ID ${existing.ID}).` };
			} else if ((existing.Active && invocation === 'ban') || (!existing.Active && invocation === 'unban')) {
				return { success: false, text: `That combination is already ${invocation}ned!` };
			}

			await existing.toggle();
			const [prefix, suffix] = existing.Active ? ['', ' again'] : ['un', ''];
			return { success: true, text: `Successfully ${prefix}banned${suffix}.${appendix}` };
		}

		if (invocation === 'unban') {
			return { success: false, text: 'This combination has not been banned yet, so it cannot be unbanned!' };
		}

		if (type === 'Arguments') {
			const { index, string } = msg.params;
			if (typeof index === 'number' && Number.isInteger(index) && typeof string === 'string') {
				options.Data = JSON.stringify({ args: [{ index, string }] });
			} else if (msg.params.all === true && typeof string === 'string') {
				options.Data = JSON.stringify({ args: [{ range: '0..Infinity', string }] });
			} else {
				return { success: false, text: `Invalid combination of parameters for the Argument type! "index" and "string" must be provided.` };
			}
		} else if (type === 'Cooldown') {
			const { multiplier } = msg.params;
			if (typeof multiplier !== 'number') {
				return { success: false, text: `No multiplier provided! Use multiplier:(number) to set it.` };
			} else if (multiplier < 1 || multiplier >= 1e6) {
				return { success: false, text: `Invalid multiplier provided! Must be in range between <1, 1 000 000>.` };
			}

			options.Data = JSON.stringify({ multiplier });
		}

		const created = await Filter.create(options);
		const summary = [
			options.User_Alias ? 'user-specific' : '',
			options.Command ? 'command-specific' : '',
			options.Invocation ? 'invocation-specific' : '',
			options.Channel ? 'channel-specific' : 'global',
			`filter of type ${options.Type}`,
		]
			.filter(Boolean)
			.join(', ');

		return { success: true, text: `Successfully banned (ID ${created.ID}). Summary: you created a ${summary}` };
	},
	dynamicDescription: (prefix) => [
		'Bans or unbans any combination of user/channel/command.',
		'Only usable by channel owners (for their channel) and bot administrators.',
		'',
		`Available types: <code>${AVAILABLE_BAN_FILTER_TYPES.join(' ')}</code>`,
		'The default type is <code>Blacklist</code>.',
		'',
		`<code>${prefix}ban user:test command:remind</code>`,
		'Bans user <u>test</u> from executing the command <u>remind</u> in the current channel.',
		'',
		`<code>${prefix}ban command:remind</code>`,
		'Bans <u>everyone</u> from executing the command <u>remind</u> in the current channel.',
		'',
		`<code>${prefix}ban invocation:rq</code>`,
		'Bans <u>everyone</u> from executing the command invocation <u>rq</u> (but not its other names) in the current channel.',
		'',
		`<code>${prefix}ban user:test</code>`,
		'Bans user <u>test</u> from executing <u>any</u> commands in the current channel.',
		'',
		`<code>${prefix}ban noResponse:true (...)</code>`,
		'The bot will not reply when this ban is triggered.',
		'',
		`<code>${prefix}ban type:offline-only (...)</code> / <code>type:online-only</code>`,
		'The combination is only available when the channel is offline / online.',
		'',
		`<code>${prefix}ban type:cooldown multiplier:(number) (...)</code>`,
		'Multiplies the cooldown of the combination by a constant (at least 1).',
		'',
		`<code>${prefix}ban type:reminder-prevention user:(user)</code>`,
		'Reminders created by that user will no longer fire in the channel (they still exist).',
		'',
		`<code>${prefix}ban type:arguments index:(number) string:(text)</code> / <code>all:true string:(text)</code>`,
		'Disables a specific argument at a position, or at any position. Repeated use stacks the items.',
		'',
		`<code>${prefix}unban (...)</code> with the same parameters (and type) reverses it.`,
		`<code>${prefix}unban type:arguments index:(number) string:(text)</code> removes one item, <code>clear:true</code> removes all, without both it disables the filter.`,
	],
};
