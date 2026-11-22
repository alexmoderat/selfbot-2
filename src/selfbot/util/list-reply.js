const { uploadToOwnHaste } = require('../token/haste.js');

/**
 * Listen nicht ueber den Chat ausschuetten: bis LIST_INLINE_MAX Eintraege inline, sonst ein Link auf
 * paste.alexmoderat.eu (alexmoderat, 24.10.2026: "alles im chat das ist arsch")
 */
const LIST_INLINE_MAX = 5;

const formatListPage = (title, items) => `${title} (${items.length} total)\n${'='.repeat(40)}\n${items.join('\n')}`;

/** "a, b, c" fuer kurze Listen, sonst der Link zur vollen Liste */
const listOrLink = async (items, title, inlineMax = LIST_INLINE_MAX) => {
	if (items.length <= inlineMax) {
		return items.join(', ');
	}

	try {
		return await uploadToOwnHaste(formatListPage(title, items));
	} catch {
		return `${items.slice(0, inlineMax).join(', ')} … (+${items.length - inlineMax})`;
	}
};

/**
 * Lange Liste auf mehrere Chat-Nachrichten verteilen statt Link: erste mit head, Eintraege mit sep getrennt, keine
 * Nachricht laenger als limit, kein Eintrag wird zerschnitten
 */
const chunkMessages = (head, items, sep, limit) => {
	const messages = [];
	let current = head;
	let empty = true;
	for (const item of items) {
		const next = empty ? `${current}${item}` : `${current}${sep}${item}`;
		if (next.length > limit && !empty) {
			messages.push(current);
			current = item;
		} else {
			current = next;
		}
		empty = false;
	}
	messages.push(current);
	return messages;
};

module.exports = { LIST_INLINE_MAX, formatListPage, listOrLink, chunkMessages };
