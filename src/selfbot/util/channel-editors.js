// Channel-Editoren wie bei DontAddThisBot (channel.editors): wer in einem Channel Donts Emote-Commands (7tv rename/yoink)
// benutzen darf. Gespeichert wird ueber die Kompatibilitaetsschicht bot.DB.channels, dieselben Daten liest Donts handler.js
// (msg.mongoChannel.editors). Gepflegt wird die Liste im Dashboard (Seite "Editors").

const MAX_EDITORS = 50;

const find = async (channel) => await bot.DB.channels.findOne({ id: channel.twitchId }).exec();

/** @returns {Promise<{ username: string, id: string, grantedAt: Date }[]>} */
const list = async (channel) => (await find(channel))?.editors ?? [];

const save = async (channel, editors) => {
	const updated = await bot.DB.channels.findOneAndUpdate({ id: channel.twitchId }, { $set: { editors } }, { new: true }).exec();
	return updated?.editors ?? editors;
};

/**
 * @param {object} channel Channel aus bot.Channels
 * @param {{ id: string, login: string }} user Twitch-Nutzer (Helix)
 * @returns {Promise<{ editors: object[] } | { error: string }>}
 */
const add = async (channel, user) => {
	if (user.id === channel.twitchId) {
		return { error: 'The broadcaster is always an editor.' };
	}
	const editors = await list(channel);
	if (editors.some((item) => item.id === user.id)) {
		return { error: `${user.login} is already an editor.` };
	}
	if (editors.length >= MAX_EDITORS) {
		return { error: `At most ${MAX_EDITORS} editors.` };
	}
	return { editors: await save(channel, [...editors, { username: user.login, id: user.id, grantedAt: new Date() }]) };
};

/** @returns {Promise<{ editors: object[] } | { error: string }>} */
const remove = async (channel, login) => {
	const editors = await list(channel);
	const rest = editors.filter((item) => item.username !== login.toLowerCase());
	if (rest.length === editors.length) {
		return { error: `${login} is not an editor.` };
	}
	return { editors: await save(channel, rest) };
};

module.exports = { list, add, remove, MAX_EDITORS };
