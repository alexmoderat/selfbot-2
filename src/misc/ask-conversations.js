// Gespraech zu !ask je User (ninou2, 20.11.2026): !askc / !askcontinue fuehrt das Gespraech fort, solange die letzte Frage
// des Users hoechstens 5 Minuten her ist; danach ist es vorbei und die naechste Frage faengt neu an. Nur im Speicher:
// nach einem Neustart ist die Fuenf-Minuten-Frist ohnehin meist abgelaufen.

const WINDOW_MS = 5 * 60_000;
const MAX_TURNS = 6;

const store = new Map();

/** Bisherige Beitraege [{ question, answer }] des Gespraechs, leer wenn keins laeuft oder es abgelaufen ist */
const active = (key, now = Date.now()) => {
	const conversation = store.get(key);
	if (!conversation) {
		return [];
	}
	if (now - conversation.at > WINDOW_MS) {
		store.delete(key);
		return [];
	}
	return conversation.turns;
};

/** Frage und Antwort merken; keep = an das laufende Gespraech anhaengen, sonst neu beginnen */
const remember = (key, question, answer, { keep = false, now = Date.now() } = {}) => {
	const turns = keep ? active(key, now) : [];
	store.set(key, { at: now, turns: [...turns, { question, answer }].slice(-MAX_TURNS) });
	for (const [other, conversation] of store) {
		if (now - conversation.at > WINDOW_MS) {
			store.delete(other);
		}
	}
};

/** Nur fuer Tests */
const clear = () => store.clear();

module.exports = { WINDOW_MS, MAX_TURNS, active, remember, clear };
