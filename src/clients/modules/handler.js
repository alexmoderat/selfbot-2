const { getConfig } = require('../../config.js');
const { Logger } = require('../../misc/logger.js');
const { replaceLinks, round, sqlDateTime } = require('../../misc/utility.js');
const { isHttpError } = require('../../token/http.js');
const { trimMessage } = require('../../util/twitch/utils.js');
const { withTrigger } = require('../../misc/trigger-suffix.js');
const { getCommand, permissionOf } = require('./commands.js');
const { CooldownManager } = require('./cooldown.js');
const { parseParametersFromArguments, formatParams } = require('./parameters.js');
const { ALT_PREFIX, parseInvocation, checkConfirmation, isMissingRequiredArgument, isAltPrefixOwnedElsewhere } = require('./invocation.js');
const { effectiveLevel, isLevelAllowed } = require('./levels.js');
const { getUtilityInvocations } = require('../../misc/command-listing.js');
const Filter = require('../../services/filter.js');
const Banphrase = require('../../services/banphrase.js');
const Users = require('../../services/users.js');
const { logCommandExecution, logError } = require('../../services/log.js');

// Wie DontAddThisBots handler.js: Prefix erkennen, Command suchen, pruefen, ausfuehren, antworten.
// Ablauf und Antworten wie bisher (Supibots Command.checkAndExecute + sb-v2-Router):
// Cooldown/pending -> Parameter -> Filter -> confirm -> Rechte -> Usage -> execute -> Links/Banphrase -> senden

const config = getConfig();
const cooldowns = new CooldownManager(config.values.pendingCommandTimeout);
// Je Sperre nur einmal "slow down" melden
const cooldownNotified = new Map();
setInterval(() => cooldowns.prune(), 10 * 60_000).unref();

/** Prefix des Channels (setprefix) oder der Standard-Prefix */
const getPrefix = (channel) => (channel ? bot.Channels.getData(channel, 'prefix') : null) ?? config.prefix;

/** Rechte des Aufrufers: Bot-Administrator, Channel-Besitzer, Mod (Badges) */
const getPermissions = (msg) => {
	const administrator = Users.isAdministrator(msg.sender);
	const channelOwner = Boolean(msg.channelData?.twitchId && msg.sender.twitchId === msg.channelData.twitchId);
	const moderator = Boolean(msg.user.perms?.mod || msg.user.perms?.broadcaster);
	return { administrator, channelOwner, moderator };
};

const checkPermissions = (command, msg) => {
	const permissions = getPermissions(msg);
	if (command.flags.includes('owner')) {
		return permissions.administrator ? { success: true } : { success: false, reason: 'permission', text: null };
	}
	// Channel kann den Command strenger stellen (!permissions, Dashboard)
	const own = command.flags.includes('mod') ? 'mod' : 'everyone';
	const overrides = msg.channelData ? bot.Channels.getData(msg.channelData, 'commandLevels') : null;
	const level = effectiveLevel(own, overrides?.[command.name]);
	if (level === 'everyone' || isLevelAllowed(permissions, level)) {
		return { success: true };
	}
	return { success: false, reason: 'permission', text: null };
};

/**
 * Command pruefen und ausfuehren (auch fuer Custom Commands und das Dashboard nutzbar)
 * @returns {Promise<{ success?: boolean, reason?: string, text?: string|null, reply?: boolean, whisper?: boolean }>}
 */
const checkAndExecute = async (msg, options = {}) => {
	const channel = msg.channelData;
	const user = msg.sender;
	const identifier = msg.invocation;

	if (channel && !bot.Channels.isWritable(channel)) {
		return { success: false, reason: `channel-${channel.mode.toLowerCase()}` };
	}

	const command = options.command ?? getCommand(identifier);
	if (!command) {
		return { success: false, reason: 'no-command' };
	}
	if (!command.ready) {
		return { success: false, reason: 'not-ready' };
	}

	const channelKey = channel?.id ?? null;
	// Der Broadcaster ist in seinem eigenen Chat nie vom Cooldown betroffen (ninou2, 17.10.2026)
	const skipCooldown = msg.debug || Boolean(msg.user.perms?.broadcaster);
	if (!skipCooldown && !cooldowns.check(channelKey, user.id, command.name, Boolean(options.skipPending))) {
		const pending = cooldowns.fetchPending(user.id);
		if (!pending && command.flags.includes('cooldown-notice')) {
			const remaining = cooldowns.remaining(channelKey, user.id, command.name);
			const key = `${channelKey ?? 'pm'}:${user.id}:${command.name}`;
			if (remaining && cooldownNotified.get(key) !== remaining.until) {
				cooldownNotified.set(key, remaining.until);
				return { success: false, reason: 'cooldown', text: `@${msg.displayName}, slow down — ${remaining.seconds}s left.` };
			}
		}
		return { success: false, reason: pending ? 'pending' : 'cooldown', text: pending && msg.privateMessage ? pending.description : null };
	}

	if (!skipCooldown && !options.skipPending) {
		cooldowns.setPending(user.id, `You have a pending command: "${identifier}" used in "${channel?.name ?? 'PMs'}" at ${sqlDateTime()}`);
	}

	// Wie Supibot: Cooldown-Filter (ban type:cooldown multiplier:x) veraendern die Laenge
	const finish = (length) => {
		cooldowns.unsetPending(user.id);
		if (skipCooldown || length === null) {
			return;
		}
		const modifier = Filter.getCooldownModifiers({ channel, command, invocation: identifier, user });
		const result = modifier ? Filter.applyData(modifier, length) : length;
		if (result !== null) {
			cooldowns.set(channelKey, user.id, command.name, result);
		}
	};

	let args = msg.rawArgs.filter(Boolean);
	let params = {};
	let failedParams = null;
	if (command.params.length > 0) {
		const parsed = parseParametersFromArguments(command.params, args);
		// Wie Supibot: nicht sofort abbrechen, erst die Filter pruefen
		if (!parsed.success) {
			failedParams = parsed.reply;
		} else {
			args = parsed.args;
			params = parsed.parameters;
		}
	}

	const filterData = await Filter.execute({ user, command, invocation: identifier, channel, targetUser: args[0] ?? null, args });
	if (!filterData.success) {
		finish(command.cooldown);
		return { success: false, reason: `filter-${filterData.reason}`, text: filterData.reply };
	} else if (failedParams !== null) {
		finish(command.cooldown);
		return { success: false, reason: 'params', text: failedParams };
	}

	// Loeschen/Zuruecksetzen nur mit "yes" am Ende (ninou2, 06.10.2026)
	const confirmation = command.flags.includes('confirm') ? checkConfirmation(args) : null;
	if (confirmation) {
		args = confirmation.args;
	}

	msg.command = command;
	msg.args = args;
	msg.params = params;

	const permissionCheck = checkPermissions(command, msg);
	if (!permissionCheck.success) {
		finish(command.cooldown);
		return permissionCheck;
	}

	if (isMissingRequiredArgument(command.usage, args)) {
		finish(command.cooldown);
		const usage = command.usage.startsWith('!') ? command.usage : `${msg.prefix}${command.usage}`;
		const description = command.description ? ` — ${command.description}` : '';
		return { success: false, reason: 'usage', text: `@${msg.displayName}, Usage: ${usage}${description}` };
	} else if (confirmation?.destructive && !confirmation.confirmed) {
		finish(command.cooldown);
		return {
			success: false,
			reason: 'confirm',
			text: `@${msg.displayName}, this deletes or resets data. To confirm, run: ${msg.prefix}${[identifier, ...args, 'yes', ...formatParams(params)].join(' ')}`,
		};
	}

	const logBase = { userId: user.id, command: command.name, channelId: channel?.id ?? null, invocation: identifier, arguments: args };

	let execution;
	try {
		const start = process.hrtime.bigint();
		msg.commandName = command.name;
		const response = (await command.execute(bot.Client, msg)) ?? {};
		const end = process.hrtime.bigint();

		logCommandExecution({
			...logBase,
			executed: new Date(),
			success: response.success !== false,
			result: response.text?.trim().slice(0, 300) ?? null,
			executionTime: round(Number(end - start) / 1_000_000, 3),
		});
		execution = response;
	} catch (error) {
		const isExternal = isHttpError(error);
		const errorId = await logError('Command', error, {
			origin: isExternal ? 'External' : 'Internal',
			context: { command: command.name, invocation: identifier, user: user.name, channel: channel?.name ?? null },
			arguments: args,
		});
		logCommandExecution({ ...logBase, executed: new Date(), success: false, result: String(error?.message).slice(0, 300), executionTime: null });
		Logger.warn(`[handler] ${command.name} fehlgeschlagen`, error);

		const idString = errorId !== null ? ` (ID ${errorId})` : '';
		execution = isExternal
			? { success: false, reason: 'http-error', text: `Third party service failed! 🚨${idString}` }
			: { success: false, reason: 'error', text: `${config.responses.commandErrorResponse}${idString}` };
	}

	finish(execution.cooldown === undefined ? command.cooldown : execution.cooldown);

	// Links ersetzen, wo sie nicht erlaubt sind, danach Supibots Ausgabe-Filter (Banphrase)
	if (execution.text && channel) {
		if (!channel.linksAllowed) {
			execution.text = replaceLinks(execution.text, '[LINK]');
		}
		if (!command.flags.includes('skip-banphrase')) {
			const banphrase = await Banphrase.execute(execution.text, channel);
			execution.text = banphrase.string;
			if (!banphrase.passed) {
				execution.success = false;
				execution.reason = 'banphrase';
			}
		}
	}

	if (execution.text && command.flags.includes('mention') && channel) {
		execution.text = `@${msg.displayName}, ${execution.text}`;
	}

	return execution;
};

/**
 * Eingehende Nachricht: Aufruf erkennen, ausfuehren, Antwort senden.
 * @returns {Promise<boolean>} ob ein Command erkannt wurde
 */
const handler = async (msg) => {
	const prefix = getPrefix(msg.channelData);
	const isNoPrefix = (invocation) => Boolean(getCommand(invocation)?.flags.includes('no-prefix'));
	const altPrefix = config.disableAltPrefix ? null : ALT_PREFIX;
	let parsed = parseInvocation(msg.text, prefix, isNoPrefix, altPrefix);
	// Eigener Channel-Prefix (z. B. "!"): der Standard-Prefix geht dort zusaetzlich weiter
	if (!parsed && prefix !== config.prefix) {
		parsed = parseInvocation(msg.text, config.prefix, isNoPrefix, altPrefix);
	}
	if (!parsed) {
		return false;
	}

	// Kein eingebauter Command (oder "!wort" ohne no-prefix-Command)? Dann die Custom Commands des Channels
	let custom = null;
	if (msg.channelData && (parsed.altOnly || !getCommand(parsed.invocation)) && bot.CustomCommands) {
		custom = await bot.CustomCommands.resolve(msg.channelData, parsed.invocation).catch(() => null);
	}

	// utility-bot (sb-v2-Code, Prefix "!") antwortet in seinen Channels selbst auf seine Commands
	const utilityKnows = (invocation) => getUtilityInvocations(config.values.otherBotCommandsDir).has(invocation);
	if (isAltPrefixOwnedElsewhere(parsed, msg.channelData?.name ?? null, config.values.utilityChannels, utilityKnows)) {
		return false;
	}
	if (parsed.altOnly && !custom) {
		return false;
	}

	msg.invocation = parsed.invocation;
	msg.rawArgs = parsed.args;
	msg.prefix = parsed.usedPrefix;

	const result = await checkAndExecute(msg, { command: custom ?? undefined });
	if (!result.text) {
		return result.reason !== 'no-command';
	}

	// Ausloesender Befehl am Ende (siehe misc/trigger-suffix.js)
	const text = withTrigger(trimMessage(result.text, config.messageLimit), msg, config.messageLimit);
	if (result.whisper || !msg.channelData) {
		await msg.whisper(text);
	} else {
		// Wie sb-v2: normal senden, als Reply nur wenn der Command es verlangt
		await msg.send(text, Boolean(result.reply));
	}
	return true;
};

module.exports = { handler, checkAndExecute, getPrefix, getPermissions, permissionOf, _cooldowns: cooldowns };
