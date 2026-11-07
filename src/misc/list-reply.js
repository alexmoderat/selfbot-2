const { uploadToOwnHaste } = require('./haste.js');

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

module.exports = { LIST_INLINE_MAX, formatListPage, listOrLink };
