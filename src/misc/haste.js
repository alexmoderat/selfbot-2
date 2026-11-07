const { request } = require('../token/http.js');

// Haste-Uploads wie sb-v2: eigener Server zuerst, clipzy als Rueckfall

const CLIPZY_ENDPOINT = 'https://clipzy.org/api/haste/paste';
const CLIPZY_VIEW = 'https://clipzy.org/haste';
/** Eigener Haste-Server (nginx -> 127.0.0.1:7777) */
const OWN_BASE = 'https://paste.alexmoderat.eu';

const uploadToHaste = async (text, options = {}) => {
	const response = await request({ method: 'POST', url: CLIPZY_ENDPOINT, json: { content: text } });
	const id = response.body?.id;
	if (!response.ok || !id) {
		throw new Error(`Haste upload returned no ID (${response.statusCode})`);
	}
	return options.raw ? `${CLIPZY_VIEW}/raw/${id}` : `${CLIPZY_VIEW}/${id}`;
};

/** hash "cmds" -> cmdlist.js auf dem eigenen Server rendert Rahmen und Trennlinien */
const uploadToOwnHaste = async (text, options = {}) => {
	try {
		const response = await request({ method: 'POST', url: `${OWN_BASE}/documents`, body: text, headers: { 'Content-Type': 'text/plain' } });
		const key = response.body?.key;
		if (!response.ok || !key) {
			throw new Error('Own haste upload returned no key');
		}
		return `${OWN_BASE}/${key}${options.hash ? `#${options.hash}` : ''}`;
	} catch {
		return await uploadToHaste(text, { raw: true });
	}
};

/** Liste mit Titelzeile und Trennlinie */
const uploadList = async (title, items, options = {}) => uploadToHaste(`${title} (${items.length} total)\n${'='.repeat(40)}\n${items.join('\n')}`, options);

module.exports = { uploadToHaste, uploadToOwnHaste, uploadList };
