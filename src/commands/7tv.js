const { getPermissions } = require('../clients/modules/handler.js');
const SupiDate = require('../util/date.js');
const {
	addEmote,
	checkSevenTvAvailable,
	fetchSevenTvChannelData,
	fetchSevenTvToken,
	findOldestIndex,
	getActiveEmoteSetId,
	getEmoteInSet,
	getEmoteData,
	getEmotesInSet,
	getGlobalEmotes,
	getSevenTvChannelData,
	searchEmotesInSet,
	removeEmote,
	SEVEN_TV_DEFAULT_LIMIT,
	sevenTvEmoteIdRegex,
	syncLocalDataToApi,
} = require('../token/seventv.js');

/**
 * Supibots 7tv: rotierende Liste von 7TV-Emotes, ueber dem Limit faellt das aelteste wieder raus (ninou2, 26.10.2026:
 * "can ur bot add emotes using 7tv link"; alexmoderat: Supibots Variante). Abweichungen:
 *  - ohne "reward" (Kanalpunkte-Bindung) - alexmoderat: "Über channelpoint will ich eigentlich nicht"
 *  - Supibots Ambassadors -> Channel-Mods (dazu Broadcaster und Bot-Administratoren)
 *  - Supibots Whitelist (Freischaltung je Channel) -> eingerichtet ist der Channel, sobald ein Mod den Command einmal
 *    benutzt; vorher antwortet er anderen nur mit "not set up"
 */
const MAX_EMOTE_LIMIT = 250;
// 401 = der 7TV-Token des Bots ist abgelaufen/ungueltig, nicht fehlende Editor-Rechte (20.11.2026: Token seit 16.11. abgelaufen,
// Meldung schickte Im_Row1 faelschlich zu den Editor-Einstellungen)
const editorHint = (statusCode) =>
	statusCode === 401 ? "my 7TV login has expired, alexmoderat has to renew it" : 'Check if I am set up as the 7TV editor for this channel';

const canManage = (permissions) => permissions.administrator || permissions.channelOwner || permissions.moderator;

/**
 * Wer !add/!remove benutzen darf: Mods (Standard) oder nur der Streamer (ninou2, 29.10.2026: "is there a way to make it
 * streamer only options"). Umschalten per "7tv access streamer|mods", nur durch den Streamer selbst.
 */
const canUseDirect = (permissions, streamerOnly) => permissions.administrator || permissions.channelOwner || (!streamerOnly && permissions.moderator);
const directDenied = async (msg) => {
	const streamerOnly = Boolean(await bot.Channels.getData(msg.channelData, 'sevenTvStreamerOnly'));
	return canUseDirect(getPermissions(msg), streamerOnly)
		? null
		: streamerOnly
			? 'only the streamer can do that in this channel.'
			: 'only mods and the streamer can do that.';
};

const access = async (msg, mode) => {
	const channel = msg.channelData;
	if (!channel) {
		return { success: false, text: 'This command cannot be used in PMs!' };
	}

	const current = Boolean(await bot.Channels.getData(channel, 'sevenTvStreamerOnly'));
	const describe = (streamerOnly) => (streamerOnly ? 'streamer only' : 'mods and the streamer');
	const value = mode?.toLowerCase();
	if (!value) {
		return { success: true, text: `!add and !remove can be used by: ${describe(current)}.` };
	}

	const permissions = getPermissions(msg);
	if (!permissions.channelOwner && !permissions.administrator) {
		return { success: false, text: 'Only the streamer can change who can use !add and !remove.' };
	}

	const streamerOnly = ['streamer', 'owner', 'broadcaster'].includes(value);
	if (!streamerOnly && !['mods', 'mod', 'moderators'].includes(value)) {
		return { success: false, text: `Usage: ${msg.prefix}7tv access streamer | ${msg.prefix}7tv access mods` };
	}

	await bot.Channels.setData(channel, 'sevenTvStreamerOnly', streamerOnly);
	return { success: true, text: `!add and !remove can now be used by: ${describe(streamerOnly)}.` };
};

const add = {
	name: 'add',
	aliases: ['replace'],
	execute: async (msg, type, ...args) => {
		const channel = msg.channelData;
		if (!channel) {
			return { success: false, text: 'This command cannot be used in PMs!' };
		}

		const localData = await fetchSevenTvChannelData(channel);
		let emoteIndexToReplace = null;
		if (type === 'replace') {
			const [emoteName] = args.splice(0, 1);
			if (!emoteName || args.length === 0) {
				return { success: false, text: "You didn't provide an emote to replace!" };
			}

			const emoteToReplace = localData.emotes.find((i) => i.name === emoteName);
			if (!emoteToReplace) {
				return { success: false, text: 'That emote is not currently in the list!' };
			} else if (emoteToReplace.requester !== msg.sender.name) {
				return { success: false, text: 'That emote has not been added by you!' };
			}

			emoteIndexToReplace = localData.emotes.indexOf(emoteToReplace);
		}

		const match = args.join(' ').match(sevenTvEmoteIdRegex);
		if (!match) {
			return { success: false, text: "You didn't provide a proper emote ID! Post a 7TV website emote link if you're unsure." };
		}

		const emoteId = match[1];
		const globalCollision = (await getGlobalEmotes()).find((i) => i.id === emoteId);
		if (globalCollision) {
			return { success: false, text: `Can't add ${globalCollision.name} because it's a global emote!` };
		}

		const apiEmotes = await getEmotesInSet(localData.emoteSetId);
		if (apiEmotes.some((i) => i.id === emoteId)) {
			return { success: false, text: 'Your provided emote is already added!' };
		}

		const emoteData = await getEmoteData(emoteId);
		if (!emoteData || emoteData.deleted) {
			const reason = !emoteData ? "doesn't exist" : 'was deleted';
			return { success: false, text: `Your provided emote ${reason}!` };
		} else if (apiEmotes.some((i) => i.alias === emoteData.defaultName)) {
			return { success: false, text: 'Your provided emote has a name conflict with an existing emote!' };
		}

		const apiEmoteIds = new Set(apiEmotes.map((i) => i.id));
		const combinedEmoteData = localData.emotes.filter((i) => apiEmoteIds.has(i.id));
		const limit = localData.limit ?? SEVEN_TV_DEFAULT_LIMIT;
		const token = fetchSevenTvToken();

		let removedEmoteString = '';
		if (combinedEmoteData.length >= limit || emoteIndexToReplace !== null) {
			const index = emoteIndexToReplace ?? findOldestIndex(combinedEmoteData);
			const candidate = combinedEmoteData[index];
			const result = await removeEmote(token, candidate.id, localData.emoteSetId);
			if (!result.success) {
				return { success: false, text: `Could not add emote! ${editorHint(result.statusCode)} (error code ${result.statusCode})` };
			}

			const [removedEmote] = combinedEmoteData.splice(index, 1);
			removedEmoteString = ` Removed ${removedEmote.name} to make space.`;
		}

		const addResult = await addEmote(token, emoteId, localData.emoteSetId);
		if (!addResult.success) {
			return { success: false, text: `Could not add emote! ${editorHint(addResult.statusCode)} (error code ${addResult.statusCode})` };
		}

		combinedEmoteData.push({
			id: emoteId,
			added: SupiDate.now(),
			name: emoteData.defaultName,
			requester: msg.sender.name,
		});

		await bot.Channels.setData(channel, 'sevenTvRotatingEmotes', { ...localData, emotes: combinedEmoteData });
		return { success: true, text: `Added ${emoteData.defaultName} to the list.${removedEmoteString}` };
	},
};

const check = {
	name: 'check',
	aliases: ['list'],
	execute: async (msg, _type, emote) => {
		if (!msg.channelData) {
			return { success: false, text: 'This command cannot be used in PMs!' };
		}

		const { emotes } = await fetchSevenTvChannelData(msg.channelData);
		if (emotes.length === 0) {
			return { success: true, text: 'There are no rotating 7TV emotes set up in this channel right now.' };
		}

		const targetEmote = emote ? emotes.find((i) => i.name === emote) : null;
		if (targetEmote) {
			const { requester, added, name } = targetEmote;
			const who = requester === msg.sender.name ? 'you' : requester;
			return { success: true, text: `${name} added by ${who} ${bot.Utils.timeDelta(added)}.` };
		}

		const prefix = emote ? "Could not find your emote, so here's a list: " : '';
		const names = emotes
			.toSorted((a, b) => a.added - b.added)
			.map((i) => i.name)
			.join(' ');
		return { success: true, text: `${prefix}Current emotes (oldest to newest): ${names}` };
	},
};

const limit = {
	name: 'limit',
	aliases: ['amount'],
	execute: async (msg, _type, rawLimit) => {
		if (!msg.channelData) {
			return { success: false, text: 'This command cannot be used in PMs!' };
		}

		const localData = await fetchSevenTvChannelData(msg.channelData);
		if (typeof rawLimit !== 'string') {
			return { success: true, text: `Current amount: ${localData.limit ?? SEVEN_TV_DEFAULT_LIMIT} emotes.` };
		} else if (!canManage(getPermissions(msg))) {
			return { success: false, text: "You can't change the amount! Only mods and channel owners can." };
		}

		const value = Number(rawLimit);
		if (!bot.Utils.isValidInteger(value, 1) || value > MAX_EMOTE_LIMIT) {
			return { success: false, text: `Your provided amount is not valid! It should an integer value between 1 and ${MAX_EMOTE_LIMIT} (inclusive).` };
		}

		localData.limit = value;
		await bot.Channels.setData(msg.channelData, 'sevenTvRotatingEmotes', localData);
		return { success: true, text: `Successfully set the amount of rotating emotes to ${value}.` };
	},
};

const remove = {
	name: 'remove',
	aliases: [],
	execute: async (msg, _type, ...args) => {
		if (!msg.channelData) {
			return { success: false, text: 'This command cannot be used in PMs!' };
		}

		const emote = args.at(0);
		if (!emote) {
			return { success: false, text: 'You must provide an emote name!' };
		}

		const localData = await fetchSevenTvChannelData(msg.channelData);
		const index = localData.emotes.findIndex((i) => i.name === emote);
		if (index === -1) {
			return { success: false, text: 'Your provided emote is either not added or is not a part of the rotating list!' };
		}

		const emoteData = localData.emotes[index];
		if (emoteData.requester !== msg.sender.name && !canManage(getPermissions(msg))) {
			return { success: false, text: "You cannot remove that emote because you didn't request it!" };
		}

		const result = await removeEmote(fetchSevenTvToken(), emoteData.id, localData.emoteSetId);
		if (!result.success) {
			return { success: false, text: `Could not remove emote! ${editorHint(result.statusCode)} (error code ${result.statusCode})` };
		}

		localData.emotes.splice(index, 1);
		await bot.Channels.setData(msg.channelData, 'sevenTvRotatingEmotes', localData);

		const who = emoteData.requester === msg.sender.name ? 'your' : `${emoteData.requester}'s`;
		return { success: true, text: `Successfully removed ${who} emote ${emote} from the list.` };
	},
};

const subcommands = [add, check, limit, remove];

/**
 * "!add <Link oder ID> [Name]" - ninou2, 26.10.2026: "the command should be like !add EMOTElink CUSTOMname", ohne Namen
 * "it adds the original name from the link". Dauerhaft ins aktive Set, nicht Teil der rotierenden Liste; nur Mods.
 */
const directAdd = async (msg, ...args) => {
	const channel = msg.channelData;
	if (!channel) {
		return { success: false, text: 'This command cannot be used in PMs!' };
	}

	const denied = await directDenied(msg);
	if (denied) {
		return { success: false, text: denied };
	}

	const [link, alias, ...rest] = args;
	const match = link?.match(sevenTvEmoteIdRegex);
	if (!match || rest.length > 0) {
		return { success: false, text: `Usage: ${msg.prefix}${msg.invocation} <7TV emote link or ID> [name]` };
	}

	const emoteId = match[1];
	const setId = await getActiveEmoteSetId(channel);
	const emoteData = await getEmoteInSet(emoteId, setId);
	if (!emoteData || emoteData.deleted) {
		const reason = !emoteData ? "doesn't exist" : 'was deleted';
		return { success: false, text: `Your provided emote ${reason}!` };
	}
	// 7TV meldet ein doppeltes Hinzufuegen nicht als Fehler - selbst pruefen
	else if (emoteData.aliasInSet) {
		return { success: false, text: `That emote is already added as ${emoteData.aliasInSet}!` };
	}

	const name = alias ?? emoteData.defaultName;
	if ((await searchEmotesInSet(setId, name)).some((i) => i.alias === name)) {
		return { success: false, text: `There's already an emote called ${name}! Use a different name.` };
	}

	const result = await addEmote(fetchSevenTvToken(), emoteId, setId, alias);
	if (!result.success) {
		return { success: false, text: `Could not add emote! ${result.error ?? editorHint(result.statusCode)} (error code ${result.statusCode})` };
	}

	return {
		success: true,
		text: alias && alias !== emoteData.defaultName ? `Added ${emoteData.defaultName} as ${alias}.` : `Added ${emoteData.defaultName}.`,
	};
};

/**
 * "!remove <Name>" - Gegenstueck zu !add (alexmoderat, 26.10.2026): entfernt ein beliebiges Emote aus dem aktiven Set;
 * Name exakt, sonst ohne Gross-/Kleinschreibung, wenn eindeutig. Nur Mods.
 */
const directRemove = async (msg, ...args) => {
	const channel = msg.channelData;
	if (!channel) {
		return { success: false, text: 'This command cannot be used in PMs!' };
	}

	const denied = await directDenied(msg);
	if (denied) {
		return { success: false, text: denied };
	}

	const [name, ...rest] = args;
	if (!name || rest.length > 0) {
		return { success: false, text: `Usage: ${msg.prefix}${msg.invocation} <emote name>` };
	}

	const setId = await getActiveEmoteSetId(channel);
	const apiEmotes = await searchEmotesInSet(setId, name);
	const exact = apiEmotes.find((i) => i.alias === name);
	const loose = apiEmotes.filter((i) => i.alias.toLowerCase() === name.toLowerCase());
	const target = exact ?? (loose.length === 1 ? loose[0] : null);
	if (!target) {
		return {
			success: false,
			text:
				loose.length > 1
					? `There are several emotes called ${name} with different capitalization - write it exactly.`
					: `There's no 7TV emote called ${name} in this channel!`,
		};
	}

	const result = await removeEmote(fetchSevenTvToken(), target.id, setId);
	if (!result.success) {
		return { success: false, text: `Could not remove emote! ${result.error ?? editorHint(result.statusCode)} (error code ${result.statusCode})` };
	}

	return { success: true, text: `Removed ${target.alias}.` };
};

module.exports = {
	name: '7tv',
	aliases: ['add', 'remove'],
	cooldown: 10000,
	description: 'Manages a rotating list of 7TV emotes, where users can add or replace a 7TV emote of their choosing within that list.',
	usage: 'add <emote link or ID> [name] | remove <emote name> | 7tv (emote link or ID) | 7tv replace <old emote> <new link> | 7tv check [emote] | 7tv limit [number] | 7tv remove <emote> | 7tv access streamer|mods (who can use add/remove)',
	flags: ['mention'],
	execute: async (client, msg) => {
		const [type, ...args] = msg.args;
		if (bot.Twitch.name !== 'twitch') {
			return { success: false, text: 'This command is only usable on Twitch!' };
		} else if (!msg.channelData) {
			return { success: false, text: 'This command cannot be used in PMs!' };
		} else if (msg.invocation === 'add') {
			return await directAdd(msg, ...[type, ...args].filter((i) => typeof i === 'string'));
		} else if (msg.invocation === 'remove') {
			return await directRemove(msg, ...[type, ...args].filter((i) => typeof i === 'string'));
		} else if (type?.toLowerCase() === 'access') {
			return await access(msg, args[0]);
		}

		// Ersatz fuer Supibots Whitelist: erst nutzbar, wenn ein Mod den Channel einmal eingerichtet hat
		if (!(await getSevenTvChannelData(msg.channelData)) && !canManage(getPermissions(msg))) {
			return { success: false, text: '7TV is not set up in this channel!' };
		} else if (!(await checkSevenTvAvailable(msg.channelData))) {
			return { success: false, text: '7TV is not set up in this channel!' };
		}

		await syncLocalDataToApi(msg.channelData);

		const name = type?.toLowerCase();
		if (!name && args.length === 0) {
			return await check.execute(msg, 'check');
		}

		const subcommand = subcommands.find((i) => i.name === name || i.aliases.includes(name ?? ''));
		if (!subcommand) {
			return await add.execute(msg, 'add', ...[type, ...args].filter((i) => typeof i === 'string'));
		}

		return await subcommand.execute(msg, name, ...args);
	},
};

Object.assign(module.exports, { canUseDirect });
