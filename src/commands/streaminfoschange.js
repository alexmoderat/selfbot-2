const { got } = require('../token/got.js');
const { getPermissions } = require('../clients/modules/handler.js');
const { parseStreamInfosLine } = require('../modules/stream-infos-restore.js');

/**
 * Aktuelle Stream-Infos als fertige /setgame- und /settitle-Zeile zum Kopieren (ninou2, 27.10.2026: "command
 * !streamInfosChange !sic", "the response : the current stream infos are : /setgame CURRENTgameName /settitle
 * CurrentStreamTitle") - Text woertlich. Einfuegen der Zeile setzt beides zurueck (Modul stream-infos-restore).
 *
 * Speicherplaetze (ninou2, 27.10.2026): "!csi save /setgame ... /settitle ... "1"" ("1" being save slot), "!csi 1" ->
 * "stream infos are : /setgame ... /settitle ...", "!csi delete 1", mehrere Plaetze ("slot : 1 - 2 - 4").
 * "!csi save 1" ohne Infos speichert die gerade aktiven (sie will nichts tippen). Mit Infos muss der Platz in
 * Anfuehrungszeichen stehen - sonst waere "part 07" am Titelende nicht von einem Platz zu unterscheiden.
 */
const formatStreamInfosChange = (game, title) => `the current stream infos are : /setgame ${game} /settitle ${title}`;
const formatSavedStreamInfos = (game, title) => `stream infos are : /setgame ${game} /settitle ${title}`;

/**
 * Ausloesender Befehl ans Ende (ninou2, 10.11.2026: "at the end [of the] responde message the [bot should] add the alias
 * [of] the command that triggered him", Beispiel '... part 16. "!csi"', "to make it easy when [searching] the logs ... for a
 * specific response", "i prefer if the [bot] does not post the alias at the end" bei anderen Commands - nur !csi).
 */
const withTrigger = (text, msg) => (msg.invocation ? `${text}. "${(msg.prefix ?? '!').trim()}${msg.invocation}"` : text);

const SLOT_PATTERN = /^[\p{L}\p{N}_-]{1,20}$/u;
const QUOTED_SLOT = /\s*["“”](?<slot>[^"“”]{1,20})["“”]\s*$/;

/** "save"-Argumente -> Platz und Infos (null = die gerade aktiven), oder null bei falscher Eingabe */
const parseSaveArgs = (args) => {
	const text = args.join(' ').trim();
	if (SLOT_PATTERN.test(text.replaceAll(/["“”]/g, '')) && !text.includes(' ')) {
		return { slot: text.replaceAll(/["“”]/g, '').toLowerCase(), infos: null };
	}

	const quoted = QUOTED_SLOT.exec(text);
	const slot = quoted?.groups?.slot.trim();
	if (!quoted || !slot || !SLOT_PATTERN.test(slot)) {
		return null;
	}

	const infos = parseStreamInfosLine(text.slice(0, quoted.index));
	return infos ? { slot: slot.toLowerCase(), infos } : null;
};

const fetchCurrent = async (broadcasterId) => {
	const response = await got('Helix')({
		url: 'channels',
		searchParams: { broadcaster_id: broadcasterId },
	});
	const info = response.body.data?.[0];
	return response.ok && info ? { game: info.game_name, title: info.title } : null;
};

const isManager = async (msg) => {
	const permissions = getPermissions(msg);
	return permissions.administrator || permissions.channelOwner || permissions.moderator;
};

module.exports = {
	name: 'streaminfoschange',
	// csi/sci: so vertippt sich ninou2 dauernd ("!csi", "!sci" beim Erklaeren, 27.10.2026)
	aliases: ['sic', 'csi', 'sci'],
	cooldown: 5000,
	description: "Posts the channel's current category and title as ready-to-copy /setgame and /settitle commands, and keeps saved slots of them.",
	usage: 'sic | sic <slot> | sic save <slot> | sic save /setgame <game> /settitle <title> "<slot>" | sic delete <slot> (also csi, sci)',
	execute: async (client, msg) => {
		const [action, ...args] = msg.args;
		const channel = msg.channelData;
		if (!channel?.twitchId || bot.Twitch.name !== 'twitch') {
			return { success: false, text: 'This command only works in a Twitch channel.' };
		}

		const display = msg.displayName;
		const slots = (await bot.Channels.getData(channel, 'streamInfoSlots')) ?? {};
		const keyword = action?.toLowerCase();

		if (keyword === 'save' || keyword === 'delete') {
			if (!(await isManager(msg))) {
				return { success: false, text: `@${display}, only mods and the channel owner can change saved slots.` };
			}

			if (keyword === 'delete') {
				const slot = args[0]?.replaceAll(/["“”]/g, '').toLowerCase();
				if (!slot) {
					return { success: false, text: `@${display}, Usage: ${msg.invocation} delete <slot>` };
				} else if (!slots[slot]) {
					return { success: false, text: `@${display}, slot ${slot} is already empty.` };
				}

				delete slots[slot];
				await bot.Channels.setData(channel, 'streamInfoSlots', slots);
				return { text: `@${display}, deleted slot ${slot}.` };
			}

			const parsed = parseSaveArgs(args);
			if (!parsed) {
				return {
					success: false,
					text: `@${display}, Usage: ${msg.invocation} save <slot> (saves the current infos) | ${msg.invocation} save /setgame <game> /settitle <title> "<slot>"`,
				};
			}

			const infos = parsed.infos ?? (await fetchCurrent(channel.twitchId));
			if (!infos) {
				return { success: false, text: `@${display}, could not fetch the current stream infos.` };
			}

			slots[parsed.slot] = infos;
			await bot.Channels.setData(channel, 'streamInfoSlots', slots);
			return { text: `@${display}, saved to slot ${parsed.slot}: ${formatSavedStreamInfos(infos.game, infos.title)}` };
		}

		if (action) {
			const slot = action.replaceAll(/["“”]/g, '').toLowerCase();
			const saved = slots[slot];
			if (!saved) {
				const used = Object.keys(slots);
				return {
					success: false,
					text: `@${display}, slot ${slot} is empty.${used.length > 0 ? ` Saved slots: ${used.join(', ')}` : ''}`,
				};
			}

			return { text: withTrigger(formatSavedStreamInfos(saved.game, saved.title), msg) };
		}

		const current = await fetchCurrent(channel.twitchId);
		if (!current) {
			return { success: false, text: 'Could not fetch the current stream infos.' };
		}

		return { text: withTrigger(formatStreamInfosChange(current.game, current.title), msg) };
	},
};

Object.assign(module.exports, { formatStreamInfosChange, formatSavedStreamInfos, parseSaveArgs, withTrigger });
