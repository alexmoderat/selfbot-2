const { got } = require('../token/got.js');
// Farbwechsel des Bot-Kontos bei jeder gesendeten Nachricht, aus sb-v2s singletons/color-cycler.ts. Account-weit
// (Farbe ist eine User-, keine Channel-Eigenschaft), Zustand in Redis, damit ein Neustart ihn nicht zuruecksetzt.

const CACHE_KEY = 'selfbot-colorcycle';

let enabled = false;
let lastColor = null;
let cycling = false;

/** Zufallsfarbe, nicht zu dunkel (schlecht lesbar auf dunklem Chat-Hintergrund) */
const randomHexColor = (random = Math.random) => {
	const part = () => (80 + Math.floor(random() * 176)).toString(16).padStart(2, '0'); // 80-255
	return `#${part()}${part()}${part()}`;
};

const initialize = async () => {
	enabled = (await bot.Redis.getJSON(CACHE_KEY)) === 'on';
};

const isEnabled = () => enabled;

const setEnabled = async (on) => {
	enabled = on;
	await bot.Redis.setJSON(CACHE_KEY, on ? 'on' : 'off');
};

/** Nach jeder gesendeten Nachricht aufrufen - ohne Wirkung, wenn aus */
const maybeCycle = async (userId) => {
	if (!enabled || cycling) {
		return;
	}

	cycling = true;
	try {
		let next = randomHexColor();
		if (next === lastColor) {
			next = randomHexColor();
		}
		lastColor = next;

		const response = await got('Helix')({
			method: 'PUT',
			url: 'chat/color',
			searchParams: { user_id: userId, color: next },
			responseType: 'text',
		});

		if (!response.ok) {
			console.warn(`[color-cycler] Wechsel fehlgeschlagen (${response.statusCode})`);
		}
	} finally {
		cycling = false;
	}
};

module.exports = { randomHexColor, initialize, isEnabled, setEnabled, maybeCycle };
