const { TWITCH_ANTIPING_CHARACTER } = require('../misc/regex.js');
const Users = require('./users.js');

// Supibots Filter (bisher classes/filter.ts): sperrt Kombinationen aus User/Channel/Command/Aufruf.
// Verwaltet ueber die Commands ban/unban. Ein Filter ist ein einfaches Objekt aus fromDoc().

const TYPES = [
	'Blacklist',
	'Whitelist',
	'Opt-out',
	'Block',
	'Unping',
	'Unmention',
	'Cooldown',
	'Flags',
	'Offline-only',
	'Online-only',
	'Arguments',
	'Reminder-prevention',
];

const filters = new Map();

const parseStringRegex = (input) => {
	const string = input.replaceAll(/^\/|\/$/g, '');
	const lastSlashIndex = string.lastIndexOf('/');
	const body = lastSlashIndex !== -1 ? string.slice(0, lastSlashIndex) : string;
	const flags = lastSlashIndex !== -1 ? string.slice(lastSlashIndex + 1) : '';
	return new RegExp(body, flags);
};

/** Zusatzdaten aus dem JSON-Text: Arguments -> [{ string|regex, index|range }], Cooldown -> { multiplier } | { override, respect } */
const createFilterData = (type, rawData, id = null) => {
	if (!rawData) {
		return null;
	}

	let data;
	try {
		data = JSON.parse(rawData);
	} catch {
		return null;
	}

	if (type === 'Arguments') {
		if (!Array.isArray(data.args)) {
			console.warn('Invalid Args filter - missing args object', { filter: id });
			return null;
		}

		const result = [];
		for (const arg of data.args) {
			const item = {};
			if (arg.regex) {
				try {
					item.regex = Array.isArray(arg.regex) ? new RegExp(arg.regex[0], arg.regex[1] ?? '') : parseStringRegex(arg.regex);
				} catch (e) {
					console.warn('Invalid string regex representation', { filter: id, e: e.message });
					continue;
				}
			} else if (arg.string) {
				item.string = arg.string;
			} else {
				console.warn('Invalid filter Args item - type', { arg, filter: id });
				continue;
			}

			if (typeof arg.index === 'number') {
				item.index = arg.index;
			} else if (Array.isArray(arg.range)) {
				item.range = arg.range.slice(0, 2).map(Number);
			} else if (typeof arg.range === 'string') {
				item.range = arg.range.split('..').map(Number).slice(0, 2);
			}

			// Infinity ist erlaubt, es steht fuer den offenen Bereich <x, ..>
			if (item.range && !item.range.every((i) => Number.isInteger(i) || i === Infinity)) {
				console.warn('Invalid numbers provided for filter Args range', { arg, filter: id });
				continue;
			}
			result.push(item);
		}
		return result;
	} else if (type === 'Cooldown') {
		const { multiplier, override, respect } = data;
		if (typeof multiplier === 'number' && override === undefined) {
			return { multiplier };
		} else if (multiplier === undefined && typeof override === 'number') {
			return { override, respect };
		}
		console.warn('Invalid Cooldown filter - incorrect combination of multiplier/override', { multiplier, override });
	}

	return null;
};

/** Alte Feldnamen (Supibots Filter-Klasse) als Getter und Instanz-Methoden, damit portierte Commands gleich lesen */
const LEGACY_FILTER_FIELDS = {
	ID: 'id',
	User_Alias: 'userId',
	Channel: 'channelId',
	Command: 'command',
	Invocation: 'invocation',
	Type: 'type',
	Response: 'response',
	Reason: 'reason',
	Blocked_User: 'blockedUser',
	Issued_By: 'issuedBy',
	Active: 'active',
	Data: 'data',
};
const withLegacy = (filter) => {
	for (const [legacy, field] of Object.entries(LEGACY_FILTER_FIELDS)) {
		Object.defineProperty(filter, legacy, {
			get: () => filter[field],
			set: (value) => {
				filter[field] = value;
			},
			enumerable: false,
		});
	}
	// Es gibt nur Twitch - Filter gelten nie fuer eine bestimmte Plattform
	Object.defineProperty(filter, 'Platform', { value: null, enumerable: false });
	Object.defineProperties(filter, {
		toggle: { value: () => toggle(filter), enumerable: false },
		saveData: { value: (raw) => saveData(filter, raw), enumerable: false },
		applyData: { value: (input) => applyData(filter, input), enumerable: false },
		priority: { get: () => priority(filter), enumerable: false },
	});
	return filter;
};

const fromDoc = (doc) =>
	withLegacy({
		id: doc._id,
		userId: doc.userId ?? null,
		channelId: doc.channelId ?? null,
		command: doc.command ?? null,
		invocation: doc.invocation ?? null,
		type: doc.type,
		response: doc.response ?? 'None',
		reason: doc.reason ?? null,
		blockedUser: doc.blockedUser ?? null,
		issuedBy: doc.issuedBy ?? null,
		active: doc.active !== false,
		rawData: doc.data ?? null,
		data: createFilterData(doc.type, doc.data ?? null, doc._id),
	});

/** Arguments: true wenn ein Argument passt; Cooldown: veraenderte Laenge */
const applyData = (filter, input) => {
	if (filter.type === 'Arguments' && Array.isArray(input)) {
		for (const { index, range, regex, string } of filter.data ?? []) {
			for (let i = 0; i < input.length; i++) {
				const positionCheck = typeof index === 'number' ? i === index : Boolean(range && range[0] <= i && i <= range[1]);
				const valueCheck = typeof string === 'string' ? input[i] === string : Boolean(regex?.test(input[i]));
				if (positionCheck && valueCheck) {
					return true;
				}
			}
		}
		return false;
	} else if (filter.type === 'Cooldown' && filter.data && (input === null || typeof input === 'number')) {
		const value = input ?? 0; // null-Cooldowns zaehlen als 0
		const { multiplier, override, respect } = filter.data;
		if (typeof override === 'number') {
			return respect === false ? override : Math.min(override, value);
		} else if (typeof multiplier === 'number') {
			return input === null ? input : Math.round(value * multiplier);
		}
	}

	throw new Error(`Invalid combination of input data and filter type (${filter.type})`);
};

/** Prioritaet wie bei Supibot als Bitmaske: User > Aufruf > Command > Channel */
const priority = (filter) =>
	(filter.channelId ? 0b0000_0010 : 0) | (filter.command ? 0b0000_0100 : 0) | (filter.invocation ? 0b0000_1000 : 0) | (filter.userId ? 0b0001_0000 : 0);

const load = async () => {
	filters.clear();
	for (const doc of await bot.DB.Filter.find({}).lean()) {
		filters.set(doc._id, fromDoc(doc));
	}
	return filters.size;
};

const get = (id) => filters.get(id) ?? null;
const all = () => [...filters.values()];

/**
 * Passende Filter fuer Channel/User/Command/Aufruf
 * @param {string} type Filter-Typ oder "all"
 * @param {{ channel?: object|null, user?: object|null, invocation?: string|null, command?: object|string|null, skipUserCheck?: boolean, includeInactive?: boolean }} options
 */
const getLocals = (type, options) => {
	const channelId = options.channel?.id ?? null;
	const userId = options.user?.id ?? null;
	const invocation = options.invocation ?? null;
	const commandName = typeof options.command === 'string' ? options.command : (options.command?.name ?? null);

	return all().filter((filter) => {
		if (type !== 'all' && filter.type !== type) {
			return false;
		} else if (!options.includeInactive && !filter.active) {
			return false;
		} else if (!options.skipUserCheck && filter.userId !== null && filter.userId !== userId) {
			return false;
		} else if (filter.channelId !== null && filter.channelId !== channelId) {
			return false;
		} else if (filter.invocation !== null && filter.invocation !== invocation) {
			return false;
		} else if (filter.command !== null && filter.command !== commandName) {
			return false;
		}
		return true;
	});
};

/** Antwort je nach Response-Typ: automatischer Text, eigener Grund oder keine */
const getReason = ({ string, response, reason }) => {
	if (response === 'Auto') {
		return string;
	} else if (response === 'Reason') {
		return reason ?? null;
	}
	return null;
};

const getBlacklistAutoReply = (filter) => {
	const { channelId: channel, userId: user, command, invocation } = filter;
	if (channel && user && command && invocation) return 'You cannot execute this command invocation in this channel.';
	if (channel && user && command) return 'You cannot execute this command in this channel.';
	if (channel && command) return 'This command cannot be executed in this channel.';
	if (channel && user) return 'You cannot execute any commands in this channel.';
	if (user && command && invocation) return 'You cannot execute this command invocation in any channel.';
	if (user && command) return 'You cannot execute this command in any channel.';
	if (user) return 'You cannot execute any commands in any channel.';
	if (command && invocation) return 'This command invocation cannot be executed anywhere.';
	if (command) return 'This command cannot be executed anywhere.';
	if (channel) return 'No commands can be executed in this channel.';
	throw new Error(`Unrecognized filter configuration (ID ${filter.id})`);
};

/**
 * Prueft alle passenden Filter fuer einen Command-Aufruf; Administratoren sind ausgenommen
 * @returns {Promise<{ success: true } | { success: false, reason: string, reply: string|null, filter: object }>}
 */
const execute = async (options) => {
	const { command, targetUser, user, channel = null, args } = options;
	if (Users.isAdministrator(user)) {
		return { success: true };
	}

	const localFilters = getLocals('all', { ...options, channel, skipUserCheck: true });
	const targetText = (filter, amount) => `${filter.command ? 'this' : amount} ${filter.invocation ? 'command invocation' : 'command'}`;

	if (command.flags.includes('whitelist')) {
		const isWhitelisted = localFilters.some((i) => i.type === 'Whitelist' && (i.userId === user.id || i.userId === null));
		if (!isWhitelisted) {
			return {
				success: false,
				reason: 'whitelist',
				filter: { reason: 'Reply' },
				reply: command.whitelistResponse ?? "You can't use this command as it is whitelisted!",
			};
		}
	}

	const argumentFilter = localFilters.find((i) => i.type === 'Arguments' && applyData(i, args));
	if (argumentFilter) {
		return {
			success: false,
			reason: 'arguments',
			filter: argumentFilter,
			reply: getReason({ ...argumentFilter, string: `You cannot use this argument on this position for ${targetText(argumentFilter, 'any')}!` }),
		};
	}

	const checksTarget = command.flags.includes('opt-out') || command.flags.includes('block');
	const userTo = checksTarget && targetUser ? await Users.get(targetUser) : null;
	if (userTo) {
		const optout = localFilters.find((i) => i.type === 'Opt-out' && i.userId === userTo.id);
		if (optout) {
			const string =
				user.id === optout.userId
					? `🚫 You have opted out from being the target of ${targetText(optout, 'every')}! This includes yourself! 😅`
					: `🚫 That user has opted out from being the target of ${targetText(optout, 'every')}!`;
			return { success: false, reason: 'opt-out', filter: optout, reply: getReason({ ...optout, string }) };
		}

		const block = localFilters.find((i) => i.type === 'Block' && i.userId === userTo.id && (i.blockedUser === user.id || i.blockedUser === null));
		if (block) {
			return {
				success: false,
				reason: 'block',
				filter: block,
				reply: getReason({ ...block, string: `🚫 That user has blocked you from being the target of ${targetText(block, 'every')}!` }),
			};
		}
	}

	const blacklist = localFilters.find((i) => i.type === 'Blacklist' && (i.userId === user.id || i.userId === null));
	if (blacklist) {
		let reply = null;
		if (blacklist.response === 'Reason') {
			reply = blacklist.reason;
		} else if (blacklist.response === 'Auto') {
			reply = getBlacklistAutoReply(blacklist);
		}
		return { success: false, reason: 'blacklist', filter: blacklist, reply };
	}

	const channelLive = channel ? bot.Channels.isLive(channel) : null;
	const offlineOnly = localFilters.find((i) => i.type === 'Offline-only' && (i.userId === user.id || i.userId === null));
	if (offlineOnly && channelLive === true) {
		const type = offlineOnly.invocation ? 'command invocation' : 'command';
		return {
			success: false,
			reason: 'offline-only',
			filter: offlineOnly,
			reply: getReason({ ...offlineOnly, string: `🚫 This ${type} is only available when the channel is offline!` }),
		};
	}

	const onlineOnly = localFilters.find((i) => i.type === 'Online-only' && (i.userId === user.id || i.userId === null));
	if (onlineOnly && channelLive === false) {
		const type = onlineOnly.invocation ? 'command invocation' : 'command';
		return {
			success: false,
			reason: 'online-only',
			filter: onlineOnly,
			reply: getReason({ ...onlineOnly, string: `🚫 This ${type} is only available when the channel is online!` }),
		};
	}

	return { success: true };
};

/** Neuer Filter (ban-Command) */
/** Optionen auch mit den alten Namen (User_Alias, Channel, Type, Issued_By, ...) */
const LEGACY_CREATE_KEYS = {
	User_Alias: 'userId',
	Channel: 'channelId',
	Command: 'command',
	Invocation: 'invocation',
	Type: 'type',
	Response: 'response',
	Reason: 'reason',
	Blocked_User: 'blockedUser',
	Issued_By: 'issuedBy',
	Data: 'data',
};

const create = async (input) => {
	const options = {};
	for (const [key, value] of Object.entries(input)) {
		if (key !== 'Platform') {
			options[LEGACY_CREATE_KEYS[key] ?? key] = value;
		}
	}
	const doc = await bot.DB.Filter.create({
		_id: await bot.DB.nextId('filters'),
		channelId: options.channelId ?? null,
		command: options.command ?? null,
		userId: options.userId ?? null,
		invocation: options.invocation ?? null,
		data: options.data ?? null,
		type: options.type ?? 'Blacklist',
		response: options.response ?? 'Auto',
		reason: options.reason ?? null,
		blockedUser: options.blockedUser ?? null,
		active: true,
		issuedBy: options.issuedBy,
	});
	const filter = fromDoc(doc.toObject());
	filters.set(filter.id, filter);
	return filter;
};

const toggle = async (filter) => {
	filter.active = !filter.active;
	await bot.DB.Filter.updateOne({ _id: filter.id }, { $set: { active: filter.active, changed: new Date() } });
};

const saveData = async (filter, raw) => {
	await bot.DB.Filter.updateOne({ _id: filter.id }, { $set: { data: raw, changed: new Date() } });
	filter.rawData = raw;
	filter.data = createFilterData(filter.type, raw, filter.id);
};

const getMentionStatus = (options) => getLocals('Unmention', options).length === 0;

/** Unping: Namen bekommen ein unsichtbares Zeichen an zweiter Stelle; nicht vor "." und "@" (URLs, Mails) */
const applyUnping = async (options) => {
	const list = getLocals('Unping', { ...options, skipUserCheck: true }).filter(
		(i) => i.blockedUser === null || options.executor === null || i.blockedUser === options.executor?.id,
	);

	let { string } = options;
	for (const filter of list) {
		const user = filter.userId ? await Users.get(filter.userId) : null;
		if (!user) {
			continue;
		}
		const regex = new RegExp(String.raw`(?<![\/=])\b(${user.name})(?![.@]\w+)`, 'gi');
		string = string.replace(regex, (name) => `${name[0]}${TWITCH_ANTIPING_CHARACTER}${name.slice(1)}`);
	}
	return string;
};

const getCooldownModifiers = (options) => getLocals('Cooldown', options).sort((a, b) => priority(b) - priority(a))[0] ?? null;

/** User-IDs, deren Reminder in diesem Channel nicht ausgeloest werden */
const getReminderPreventions = (options) => getLocals('Reminder-prevention', { ...options, skipUserCheck: true }).map((i) => i.userId);

module.exports = {
	TYPES,
	load,
	get,
	all,
	getLocals,
	execute,
	create,
	toggle,
	saveData,
	applyData,
	getReason,
	getBlacklistAutoReply,
	getMentionStatus,
	applyUnping,
	getCooldownModifiers,
	getReminderPreventions,
	createFilterData,
	fromDoc,
	_filters: filters,
};
