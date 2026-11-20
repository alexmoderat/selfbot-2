const { got } = require('./got.js');
const z = require('zod');
const { SupiError } = require('../util/error.js');

// 7TV-API fuer den 7tv-Command, aus Supibots commands/7tv/subcommands/index.ts (v4-GQL). Abweichung: Supibot nimmt die
// 7TV-User-ID als Set-ID - das stimmt nur bei manchen Konten (ninou2 ja, alexmoderat nicht, 26.10.2026), hier das aktive Set.
// Globale Emotes direkt von 7TV statt ueber twitch.fetchGlobalEmotes (gibt es hier nicht).

const url = 'https://7tv.io/v4/gql';
const sevenTvEmoteIdRegex = /([A-Z0-9]{26})/;
const SEVEN_TV_DEFAULT_LIMIT = 5;

const sevenTvUserIdSchema = z.object({
	user: z.object({
		id: z.string(),
	}),
	emote_set: z.object({ id: z.string() }).nullable().optional(),
});
const sevenTvEmoteSetSchema = z.object({
	emotes: z
		.array(z.object({ id: z.string(), name: z.string() }))
		.nullable()
		.transform((i) => i ?? []),
});
const sevenTvGetEmoteSchema = z.object({
	data: z.object({
		emotes: z.object({
			emote: z
				.object({
					defaultName: z.string(),
					deleted: z.boolean(),
				})
				.nullable(),
		}),
	}),
});
const sevenTvGlobalSetSchema = z.object({
	emotes: z.array(z.object({ id: z.string(), name: z.string() })),
});

const getChannelTwitchId = (channel) => {
	if (!channel.twitchId) {
		throw new SupiError({ message: 'Assert error: Twitch channel has no user ID' });
	}

	return channel.twitchId;
};

const activeSetSchema = z.object({
	data: z.object({
		users: z.object({
			userByConnection: z
				.object({
					id: z.string(),
					style: z.object({ activeEmoteSetId: z.string().nullable() }),
				})
				.nullable(),
		}),
	}),
});

/**
 * Aktives Emote-Set des Channels (ohne aktives Set die User-ID, wie Supibot). Ueber v4 - v3 brauchte 2-3 s pro Aufruf,
 * !add/!remove dauerten so 2-8 s (alexmoderat, 26.10.2026: "9sek ist aber sehr lange").
 */
const getActiveEmoteSetId = async (channel) => {
	const query = `query ActiveSet($id: String!) {
		users {
			userByConnection(platform: TWITCH, platformId: $id) {
				id
				style { activeEmoteSetId }
			}
		}
	}`;

	const response = await got.gql({ url, query, variables: { id: getChannelTwitchId(channel) } });
	const user = activeSetSchema.parse(response.body).data.users.userByConnection;
	if (!user) {
		throw new SupiError({ message: 'Channel has no 7TV account', args: { channel: channel.name } });
	}

	return user.style.activeEmoteSetId ?? user.id;
};

const emoteInSetSchema = z.object({
	data: z.object({
		emotes: z.object({
			emote: z
				.object({
					defaultName: z.string(),
					deleted: z.boolean(),
					inEmoteSets: z.array(z.object({ emote: z.object({ alias: z.string() }).nullable() })),
				})
				.nullable(),
		}),
	}),
});

/** Emote-Daten und - falls schon im Set - sein Name dort, in einer Abfrage statt das ganze Set zu laden */
const getEmoteInSet = async (emoteId, setId) => {
	const query = `query EmoteInSet($emoteId: Id!, $setIds: [Id!]!) {
		emotes {
			emote(id: $emoteId) {
				defaultName
				deleted
				inEmoteSets(emoteSetIds: $setIds) { emote { alias } }
			}
		}
	}`;

	const response = await got.gql({ url, query, variables: { emoteId, setIds: [setId] } });
	const emote = emoteInSetSchema.parse(response.body).data.emotes.emote;
	if (!emote) {
		return null;
	}

	return {
		defaultName: emote.defaultName,
		deleted: emote.deleted,
		aliasInSet: emote.inEmoteSets.find((i) => i.emote)?.emote?.alias ?? null,
	};
};

const setSearchSchema = z.object({
	data: z.object({
		emoteSets: z.object({
			emoteSet: z
				.object({
					emotes: z.object({ items: z.array(z.object({ id: z.string(), alias: z.string() })) }),
				})
				.nullable(),
		}),
	}),
});

/** Emotes im Set, deren Name den Suchtext enthaelt (7TV sucht ohne Gross-/Kleinschreibung) */
const searchEmotesInSet = async (setId, text) => {
	const query = `query SearchSet($setId: Id!, $text: String) {
		emoteSets {
			emoteSet(id: $setId) {
				emotes(query: $text, page: 1, perPage: 100) { items { id alias } }
			}
		}
	}`;

	const response = await got.gql({ url, query, variables: { setId, text } });
	return setSearchSchema.parse(response.body).data.emoteSets.emoteSet?.emotes.items ?? [];
};

const checkSevenTvAvailable = async (channel) => {
	const response = await got('GenericAPI')({
		url: `https://7tv.io/v3/users/twitch/${getChannelTwitchId(channel)}`,
		throwHttpErrors: false,
	});

	return response.ok;
};

/** Lokale Daten der rotierenden Liste; null, solange der Channel sie nicht eingerichtet hat */
const getSevenTvChannelData = async (channel) => await bot.Channels.getData(channel, 'sevenTvRotatingEmotes');

const fetchSevenTvChannelData = async (channel) => {
	const existing = await bot.Channels.getData(channel, 'sevenTvRotatingEmotes');
	if (existing) {
		return existing;
	}

	const newSetData = {
		emoteSetId: await getActiveEmoteSetId(channel),
		emotes: [],
	};

	await bot.Channels.setData(channel, 'sevenTvRotatingEmotes', newSetData);
	return newSetData;
};

/**
 * Emotes eines Sets ueber v3: v4 liefert bei grossen Sets nicht alles - ninou2 (998 Emotes, 26.10.2026): Seite 1 mit
 * perPage 1000 gab 955 zurueck, die uebrigen 43 (darunter ein gerade per !add hinzugefuegtes) nur auf einer "Seite 2",
 * obwohl pageCount 1 meldete. !remove fand das Emote deshalb nicht.
 */
const getEmotesInSet = async (setId) => {
	const response = await got('GenericAPI')({ url: `https://7tv.io/v3/emote-sets/${setId}` });
	return sevenTvEmoteSetSchema.parse(response.body).emotes.map((i) => ({ id: i.id, alias: i.name }));
};

const getEmoteData = async (emoteId) => {
	const variables = { emoteId };
	const query = `query OneEmote($emoteId: Id!) {
		emotes {
			emote(id: $emoteId) {
				defaultName
				deleted
			}
		}
	}`;

	const response = await got.gql({ url, query, variables });
	return sevenTvGetEmoteSchema.parse(response.body).data.emotes.emote;
};

const getGlobalEmotes = async () => {
	const response = await got('GenericAPI')({ url: 'https://7tv.io/v3/emote-sets/global' });
	return sevenTvGlobalSetSchema.parse(response.body).emotes;
};

const modifySet = async (token, action, emote, setId) => {
	const variables = { emote, setId };
	const headers = { Authorization: `Bearer ${token}` };
	const query = `mutation ModifyEmoteSet($setId: Id!, $emote: EmoteSetEmoteId!) {
		emoteSets {
			emoteSet(id: $setId) {
				${action}(id: $emote) { id }
			}
		}
	}`;

	const response = await got.gql({ url, query, headers, variables, throwHttpErrors: false });
	const body = response.body;
	// 7TV meldet fehlende Editor-Rechte, volles Set u. a. auch mit 200 und errors
	if (!response.ok || (body?.errors?.length ?? 0) > 0) {
		return { success: false, statusCode: response.statusCode, error: body?.errors?.[0]?.message ?? null };
	}

	return { success: true };
};

/** alias: eigener Name im Set (ninou2, 26.10.2026: "!add EMOTElink CUSTOMname"), sonst der Originalname */
const addEmote = async (token, emoteId, setId, alias) => await modifySet(token, 'addEmote', alias ? { emoteId, alias } : { emoteId }, setId);
const removeEmote = async (token, emoteId, setId) => await modifySet(token, 'removeEmote', { emoteId }, setId);

const fetchSevenTvToken = () => {
	const token = process.env.API_7TV_TOKEN;
	if (!token) {
		throw new SupiError({ message: 'No 7TV token configured (API_7TV_TOKEN)' });
	}

	return token;
};

const syncLocalDataToApi = async (channel) => {
	const localData = await fetchSevenTvChannelData(channel);
	const liveEmotes = await getEmotesInSet(localData.emoteSetId);

	const newEmotes = [];
	for (const oldEmote of localData.emotes) {
		const liveEmote = liveEmotes.find((i) => i.id === oldEmote.id);
		if (liveEmote) {
			newEmotes.push({ ...oldEmote, name: liveEmote.alias });
		}
	}

	localData.emotes = newEmotes;
	await bot.Channels.setData(channel, 'sevenTvRotatingEmotes', localData);
};

/** Aeltester Eintrag (Supibot: Index mit kleinstem "added") */
const findOldestIndex = (emotes) => {
	let index = 0;
	let added = Infinity;
	for (let i = 0; i < emotes.length; i++) {
		if (emotes[i].added < added) {
			index = i;
			added = emotes[i].added;
		}
	}
	return index;
};

module.exports = {
	sevenTvEmoteIdRegex,
	SEVEN_TV_DEFAULT_LIMIT,
	getActiveEmoteSetId,
	getEmoteInSet,
	searchEmotesInSet,
	checkSevenTvAvailable,
	getSevenTvChannelData,
	fetchSevenTvChannelData,
	getEmotesInSet,
	getEmoteData,
	getGlobalEmotes,
	addEmote,
	removeEmote,
	fetchSevenTvToken,
	syncLocalDataToApi,
	findOldestIndex,
};
