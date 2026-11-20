const path = require('node:path');

/**
 * Chrome-TLS-Fingerprint-Fallback fuer GQL-Requests (alexmoderat, 12.11.2026: sb-v2 macht nichts mehr, der selfbot braucht
 * es jetzt), aus sb-v2s services/fingerprint-client.ts. Rust-Addon in native/boring-ssl-client (Fork von
 * Potat-Industries/rust-boring-ssl-client): HTTP/2-Request mit Chromes TLS-Handshake statt Nodes Standard-Fingerprint.
 * Reiner Request/Response-Fallback, kein Push. Ist build/linux.node nicht gebaut, wirft jeder Aufruf und der Aufrufer
 * verhaelt sich wie ohne dieses Modul.
 */
const PLATFORM_FILE = { linux: 'linux.node', darwin: 'macos.node', win32: 'win.node' };
const CHROME_HEADERS = [
	['sec-ch-ua', '"Chromium";v="131", "Not_A Brand";v="24", "Google Chrome";v="131"'],
	['sec-ch-ua-mobile', '?0'],
	['sec-ch-ua-platform', '"Windows"'],
	['user-agent', 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36'],
	['accept', '*/*'],
	['accept-language', 'en-US,en;q=0.9'],
];

let native; // undefined = noch nicht versucht, null = nicht verfuegbar

const loadNative = () => {
	if (native !== undefined) {
		return native;
	}
	const file = PLATFORM_FILE[process.platform];
	try {
		native = file ? require(path.join(__dirname, '..', '..', '..', 'native', 'boring-ssl-client', 'build', file)) : null;
		if (native) {
			console.log('[fingerprint-client] Chrome-TLS-Fingerprint-Addon geladen');
		}
	} catch {
		native = null;
	}
	return native;
};

const isAvailable = () => loadNative() !== null;

/** POST gegen gql.twitch.tv; wirft ohne Addon oder bei Nicht-2xx/Verbindungsfehler. Liefert den geparsten Body. */
const gqlPostWithFingerprint = async (body, clientId) => {
	const addon = loadNative();
	if (!addon) {
		throw new Error('fingerprint-client: Addon nicht gebaut (native/boring-ssl-client)');
	}

	const headers = [['authority', 'gql.twitch.tv'], ['content-type', 'application/json'], ['client-id', clientId], ...CHROME_HEADERS];
	const result = await addon.request({ method: 'POST', body: JSON.stringify(body), host: 'gql.twitch.tv', uri: 'https://gql.twitch.tv/gql', headers }, '', '');
	if (result.status < 200 || result.status >= 300) {
		throw new Error(`fingerprint-client: HTTP ${result.status}`);
	}
	return JSON.parse(result.bodyJson);
};

module.exports = { isAvailable, gqlPostWithFingerprint };
