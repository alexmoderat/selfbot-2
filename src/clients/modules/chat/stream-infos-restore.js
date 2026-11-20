const { got } = require('../../../token/got.js');
const { defineChatModule } = require('../chat-modules.js');
const { describeFailure, searchGameId, updateBroadcastSettings } = require('../../../util/broadcast-settings.js');
const { rolesFromBadges } = require('../../../util/text-analysis.js');

/**
 * Gegenstueck zu !sic: fuegt ein Mod/der Broadcaster die gespeicherte !sic-Antwort wieder in den Chat ein, setzt der
 * Bot Kategorie und Titel genau so zurueck. ninou2, 27.10.2026: "i type the command !sic", "i copy pasta in the chat",
 * "now i change to title and category 2", "before i end stream i type again !sic and copy pasta bot response in the
 * chat" - sie will dabei nichts tippen. Das Aufheben selbst (Zeile mit den gerade aktiven Werten) bleibt still.
 */
// Vorspann der !sic-Antwort ("the current stream infos are :") oder eines Speicherplatzes ("stream infos are :")
// Endung '. "!csi"' (ausloesender Befehl, siehe !sic) gehoert nicht zum Titel
const PATTERN = /^(?:(?:the current )?stream infos are\s*:\s*)?\/setgame\s+(.+?)\s+\/settitle\s+(.+?)(?:\.\s*"![^"\s]+")?$/i;

// !csi2 (ninou2, 13.11.2026): dieselbe Zeile mit !setgame/!settitle, fuer Chats, in denen sie als Mod/Editor den Bot-Befehl nutzt.
// Mit Vorspann ("the current stream infos are : !setgame ...") kein Befehl, deshalb greift hier das Modul; ohne Vorspann (nur
// "!setgame X !settitle Y") ist es ein Befehl und wird von setgame behandelt (bare = true: auch fuer "!csi2 save ...").
const BANG_PREFIXED = /^(?:the current )?stream infos are\s*:\s*!setgame\s+(.+?)\s+!settitle\s+(.+?)$/i;
const BANG_BARE = /^!setgame\s+(.+?)\s+!settitle\s+(.+?)$/i;

const parseStreamInfosLine = (message, { bare = false } = {}) => {
	const text = message.trim();
	const match = PATTERN.exec(text) ?? BANG_PREFIXED.exec(text) ?? (bare ? BANG_BARE.exec(text) : null);
	return match ? { game: match[1].trim(), title: match[2].trim() } : null;
};

/** Genauer Name zuerst (Helix games), sonst wie setgame der erste Suchtreffer */
const findGame = async (name) => {
	const exact = await got('Helix')({
		url: 'games',
		searchParams: { name },
	});
	const game = exact.body.data?.[0];
	if (exact.ok && game) {
		return { id: game.id, name: game.name };
	}

	const id = await searchGameId(name);
	return id ? { id, name } : null;
};

module.exports = defineChatModule({
	name: 'stream-infos-restore',
	description: 'Restores category and title when a mod pastes a !sic response back into chat.',
	scope: 'global',
	handlers: {
		message: async (context) => {
			const { channel, user, message, data } = context;
			const parsed = parseStreamInfosLine(message);
			if (!parsed || !bot.Channels.isWritable(channel)) {
				return;
			}

			const roles = rolesFromBadges(user.name, data.badges);
			if (!roles.isMod && !roles.isBroadcaster) {
				return;
			}

			// Beim Aufheben postet ninou2 die Zeile mit den gerade aktiven Werten - dann still bleiben, nichts aendern
			const current = await got('Helix')({
				url: 'channels',
				searchParams: { broadcaster_id: channel.twitchId ?? '' },
			});
			const now = current.body.data?.[0];
			if (now && now.game_name.toLowerCase() === parsed.game.toLowerCase() && now.title.trim() === parsed.title) {
				return;
			}

			const display = data.displayName;
			const game = await findGame(parsed.game);
			if (!game) {
				await bot.Channels.send(channel, `@${display}, game "${parsed.game}" not found.`);
				return;
			}

			const result = await updateBroadcastSettings(channel, { title: parsed.title, gameId: game.id, gameName: game.name });
			await bot.Channels.send(channel, result.ok ? `@${display}, stream infos restored: "${game.name}" - "${parsed.title}"` : describeFailure(result, display));
		},
	},
});

Object.assign(module.exports, { parseStreamInfosLine, findGame });
