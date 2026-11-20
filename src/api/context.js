const path = require('node:path');
const { baseUrl } = require('../misc/user-tokens.js');

// Die Seiten in public/ liegen hinter nginx unter WEB_BASE_URL (Testphase: https://auth.alexmoderat.eu/selfbot,
// Prefix wird abgeschnitten) und verwenden deshalb relative Pfade.
const PUBLIC_DIR = path.join(__dirname, 'public');

const basePath = (() => {
	try {
		return new URL(baseUrl()).pathname.replace(/\/+$/, '');
	} catch {
		return '';
	}
})();

module.exports = { PUBLIC_DIR, basePath };
