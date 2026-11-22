const { client } = require('../../util/twitch/connections.js');
const { setModerator, isProtected } = require('../../util/channel-manager.js');
const { isServed } = require('../JoinChannels.js');

// Wie DontAddThisBots clients/events/USERSTATE.js: der Bot merkt sofort, wenn er in einem Channel Mod wird oder es nicht mehr ist
// (Badge in USERSTATE), statt auf den Abgleich per Helix alle 2 Minuten zu warten (crons/auto-join). Dont schreibt is_mod/is_vip in
// eine Tabelle, hier ist es der Mode des Channels (Moderator <-> Write); VIP-Channels bleiben, Read und Inactive werden nie angefasst.

/** Mode-Wechsel, den dieses USERSTATE ausloest: true = Moderator, false = Write, null = nichts tun */
const wantedModerator = (channel, isMod) => {
	if (!channel || channel.mode === 'Inactive' || channel.mode === 'Read' || !channel.twitchId) {
		return null;
	}
	if (isMod) {
		return channel.mode === 'Moderator' ? null : true;
	}
	return channel.mode === 'Moderator' ? false : null;
};

const handleUserstate = async ({ channelName, isMod }) => {
	const channel = bot.Channels.get(channelName);
	if (!channel || isProtected(channel) || !isServed(channelName)) {
		return;
	}
	const wanted = wantedModerator(channel, isMod);
	if (wanted !== null) {
		await setModerator(channel, wanted);
	}
};

const USERSTATE = async function () {
	client.on('USERSTATE', (message) => {
		handleUserstate(message).catch((e) => bot.Logger.warn('[userstate] Mode-Wechsel fehlgeschlagen', e.message));
	});
};

module.exports = { USERSTATE, wantedModerator, handleUserstate };
