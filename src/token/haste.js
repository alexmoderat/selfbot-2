const { request } = require('./http.js');

// Haste-Uploads wie sb-v2: eigener Server zuerst, clipzy als Rueckfall

const CLIPZY_ENDPOINT = 'https://clipzy.org/api/haste/paste';
const CLIPZY_VIEW = 'https://clipzy.org/haste';
/** Eigener Haste-Server (nginx -> 127.0.0.1:7777) */
const OWN_BASE = 'https://paste.alexmoderat.eu';

const uploadToClipzy = async (text, options = {}) => {
	const response = await request({ method: 'POST', url: CLIPZY_ENDPOINT, json: { content: text } });
	const id = response.body?.id;
	if (!response.ok || !id) {
		throw new Error(`Haste upload returned no ID (${response.statusCode})`);
	}
	return options.raw ? `${CLIPZY_VIEW}/raw/${id}` : `${CLIPZY_VIEW}/${id}`;
};

/**
 * Eigener Server zuerst, clipzy nur als Rueckfall. hash "cmds" -> cmdlist.js auf dem eigenen Server rendert Rahmen und
 * Trennlinien; raw: true -> Rohtext-Link (auch beim Rueckfall).
 */
const uploadToOwnHaste = async (text, options = {}) => {
	try {
		const response = await request({ method: 'POST', url: `${OWN_BASE}/documents`, body: text, headers: { 'Content-Type': 'text/plain' } });
		const key = response.body?.key;
		if (!response.ok || !key) {
			throw new Error('Own haste upload returned no key');
		}
		return options.raw ? `${OWN_BASE}/raw/${key}` : `${OWN_BASE}/${key}${options.hash ? `#${options.hash}` : ''}`;
	} catch {
		return await uploadToClipzy(text, { raw: true });
	}
};

// alexmoderat, 11.11.2026 ("sb ml" verlinkte clipzy): "Kannst du mal umstellen auf meine Seite" - alle Listen-Links
// gehen jetzt auf paste.alexmoderat.eu, clipzy bleibt nur Rueckfall
const uploadToHaste = uploadToOwnHaste;

/** Liste mit Titelzeile und Trennlinie */
const uploadList = async (title, items, options = {}) => uploadToHaste(`${title} (${items.length} total)\n${'='.repeat(40)}\n${items.join('\n')}`, options);

module.exports = { uploadToHaste, uploadToOwnHaste, uploadToClipzy, uploadList };
