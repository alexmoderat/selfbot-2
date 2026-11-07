const { got } = require('../token/got.js');
const { gqlSmartbox } = require('./twitch-gql.js');
const { forceRefreshToken, getValidToken, helixAsUser } = require('./user-tokens.js');

/**
 * Titel/Kategorie eines Channels aendern, aus sb-v2s v2/utils/broadcast-settings.ts.
 * - eigener Channel (Broadcaster = Bot-Account): Helix PATCH /channels mit dem eigenen Token (channel:manage:broadcast)
 * - sonst Editor-Weg: GQL-Mutation updateBroadcastSettings mit alexmoderats SmartBox-Token (alexmoderat, 02.10.2026:
 *   "per chat cmd den Titel aendern kann wo ich editor rechte hab")
 * Davor wie in sb-v2 der Token des Broadcasters aus dem Auth-Server (/auth/<channel>, Block 9), einmal erneuert nach Fehler.
 */

const updateViaHelix = async (broadcasterId, edit) => {
	const response = await got('Helix')({
		method: 'PATCH',
		url: 'channels',
		searchParams: { broadcaster_id: broadcasterId },
		json: {
			...(edit.title !== undefined ? { title: edit.title } : {}),
			...(edit.gameId !== undefined ? { game_id: edit.gameId } : {}),
		},
		responseType: 'text',
	});
	return response.statusCode === 204;
};

const updateWithToken = async (token, broadcasterId, edit) => {
	const response = await helixAsUser(token, {
		method: 'PATCH',
		url: 'channels',
		searchParams: { broadcaster_id: broadcasterId },
		json: {
			...(edit.title !== undefined ? { title: edit.title } : {}),
			...(edit.gameId !== undefined ? { game_id: edit.gameId } : {}),
		},
	}).catch(() => null);
	return response?.statusCode === 204;
};

const updateViaEditor = async (broadcasterId, edit) => {
	const fields = [`userID: ${JSON.stringify(broadcasterId)}`];
	if (edit.title !== undefined) {
		fields.push(`status: ${JSON.stringify(edit.title)}`);
	}
	if (edit.gameName !== undefined) {
		fields.push(`game: ${JSON.stringify(edit.gameName)}`);
	}

	const data = await gqlSmartbox(`mutation { updateBroadcastSettings(input: { ${fields.join(', ')} }) { error broadcastSettings { title } } }`).catch(
		() => null,
	);
	if (data === null) {
		return null; // nicht konfiguriert oder Fehler
	}
	const result = data.updateBroadcastSettings;
	const ok = Boolean(result && !result.error && result.broadcastSettings);
	if (!ok) {
		console.warn(`[broadcast-settings] Editor-Weg fuer ${broadcasterId} abgelehnt: ${JSON.stringify(data)}`);
	}
	return ok;
};

const updateBroadcastSettings = async (channel, edit) => {
	const login = channel.name;
	if (!channel.twitchId) {
		return { ok: false, reason: 'no-broadcaster-id', login };
	}

	if (channel.twitchId === bot.Config.selfId) {
		return (await updateViaHelix(channel.twitchId, edit)) ? { ok: true } : { ok: false, reason: 'update-failed', login };
	}

	const token = await getValidToken(login);
	if (token) {
		if (await updateWithToken(token, channel.twitchId, edit)) {
			return { ok: true };
		}
		const fresh = await forceRefreshToken(login);
		if (fresh && (await updateWithToken(fresh, channel.twitchId, edit))) {
			return { ok: true };
		}
	}

	const viaEditor = await updateViaEditor(channel.twitchId, edit);
	if (viaEditor === true) {
		return { ok: true };
	}
	return token ? { ok: false, reason: 'update-failed', login } : { ok: false, reason: 'no-token', login, editorTried: viaEditor === false };
};

/** Einheitliche Fehlermeldung fuer settitle und setgame (Texte aus sb-v2) */
const describeFailure = (result, displayName) => {
	switch (result.reason) {
		case 'no-broadcaster-id':
			return `@${displayName}, failed to get broadcaster ID.`;
		case 'no-token':
			return `@${displayName}, no token found for channel ${result.login}. Please authorize via web interface${result.editorTried ? ' (and no editor rights there either)' : ''}.`;
		default:
			return `@${displayName}, update failed. Check permissions (channel:manage:broadcast).`;
	}
};

/** Kategorie-ID per Suche (sb-v2 searchGameId: erster Treffer von search/categories) */
const searchGameId = async (name) => {
	const response = await got('Helix')({
		url: 'search/categories',
		searchParams: { query: name, first: 1 },
	});
	return response.ok ? (response.body.data[0]?.id ?? null) : null;
};

module.exports = { updateBroadcastSettings, describeFailure, searchGameId };
