const customCommands = require('../util/custom-commands.js');
const { DEFAULT_TEMPLATE } = require('../util/lastlive-data.js');
const { resolveVariables } = require('../util/live-variables.js');

/**
 * Wann ein Channel zuletzt live war (ninou2, 02.10.2026, Alias "ll"). Die Logik steckt in util/lastlive-data.js, der Text in
 * einer Vorlage mit {ll_*}-Variablen: als Custom Command "!ll" in den Channels (alexmoderat, 22.11.2026: "ich moechte aber
 * custom cmd"). Dieser Command bleibt fuer "sb ll", die Website-Liste und den Selbsttest und nutzt die Vorlage von
 * "!ll" aus ninou2 (Aenderungen dort gelten auch hier), sonst die Standardvorlage.
 */
const MAIN_CHANNEL = 'ninou2';

const template = async () => {
	try {
		const channel = bot.Channels.get(MAIN_CHANNEL);
		return (channel && (await customCommands.get(channel, '!ll'))?.Response) || DEFAULT_TEMPLATE;
	} catch {
		return DEFAULT_TEMPLATE;
	}
};

module.exports = {
	name: 'lastlive',
	aliases: ['ll'],
	cooldown: 3000,
	description:
		'When a channel last went live (start, end and length from the latest VOD or the recorded streaming days). The yearly stream count is shown for channels tracked via streaktrack. Defaults to the current channel.',
	usage: 'lastlive [channel]',
	execute: async (client, msg) => {
		const channelName = msg.channelData?.name ?? '';
		const text = await resolveVariables(customCommands.formatResponse(await template(), msg.sender?.name ?? msg.displayName, channelName), msg.args, { channel: channelName });
		return { text };
	},
};
