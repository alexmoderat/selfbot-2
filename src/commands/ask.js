const { got } = require('../token/got.js');
const conversations = require('../misc/ask-conversations.js');

/**
 * Frage an eine KI, wie Supibots $gpt (ninou2, 19.11.2026: "was thinking about an !ask command just like the GPT one from
 * supibot", "if it cost nothing"). Kostenlos ueber das Gratis-Kontingent der Gemini-API (Schluessel GEMINI_API_KEY aus
 * Google AI Studio, Modell per GEMINI_MODEL aenderbar, Standard gemini-flash-lite-latest). Statt einer zweiten KI zum Zusammenfassen wird Gemini direkt um eine
 * kurze Antwort gebeten, lange Antworten gehen auf bis zu 3 Nachrichten; ist das Tageskontingent aufgebraucht (429), kommt "try again later".
 */
// gemini-2.5-flash gibt es fuer neue Schluessel nicht mehr, die grossen Flash-Modelle waren beim Einrichten (19.11.2026)
// ueberlastet (503/Timeout) - die Lite-Variante antwortet zuverlaessig
const DEFAULT_MODEL = 'gemini-flash-lite-latest';
const MAX_QUESTION = 500;
// Lange Antworten auf mehrere Nachrichten verteilt (ninou2, 19.11.2026: "if the answer [is] long, the [bot] post it [in]
// multiple messages" wie andere Bots), hoechstens 3 Nachrichten
const PART_SIZE = 440;
const MAX_PARTS = 3;
const MAX_ANSWER = PART_SIZE * MAX_PARTS;
// Zusammenfassen nur, wenn die Antwort sehr lang oder voller Daten waere; einfache Antworten normal (ninou2, 19.11.2026:
// "make it shorter, like make a better summary", dann: "do that if the answer [is] considered very long and have soo many
// infos/data given at once", "if the answer [is] simple no need to summarize")
const SYSTEM_PROMPT =
	'You are a helpful bot in a Twitch chat. If the question has a simple answer, just answer it normally and naturally ' +
	'in a sentence or two. Only if the full answer would be very long or packed with many facts, numbers or items at ' +
	'once, give a short summary instead: the direct answer first, then only the most important points, easy to read ' +
	'at a glance. Never more than 1000 characters. ' +
	'Answer in the same language as the question. Plain text only: no markdown, no lists, no line breaks, no links.';

/** Antwort aus der Gemini-Antwort holen; null = gesperrt/leer */
const extractAnswer = (body) => {
	const candidate = body?.candidates?.[0];
	const parts = Array.isArray(candidate?.content?.parts) ? candidate.content.parts : [];
	const text = parts
		.filter((p) => !p.thought && typeof p.text === 'string')
		.map((p) => p.text)
		.join(' ');
	return text.trim() ? text : null;
};

/** Eine Zeile, ohne Markdown-Sternchen/Backticks, auf MAX_ANSWER Zeichen gekuerzt (Ende mit …) */
const cleanAnswer = (text) => {
	const line = String(text)
		.replaceAll(/[*_`#]+/g, '')
		.replaceAll(/\s+/g, ' ')
		.trim();
	return line.length > MAX_ANSWER ? `${line.slice(0, MAX_ANSWER - 1).trimEnd()}…` : line;
};

/** Antwort an Wortgrenzen in Stuecke von hoechstens size Zeichen teilen */
const splitAnswer = (text, size = PART_SIZE) => {
	const parts = [];
	let rest = text.trim();
	while (rest.length > size) {
		const cut = rest.lastIndexOf(' ', size);
		const at = cut > size / 2 ? cut : size;
		parts.push(rest.slice(0, at).trimEnd());
		rest = rest.slice(at).trimStart();
	}
	if (rest) {
		parts.push(rest);
	}
	return parts;
};

/** history = frueherer Verlauf [{ question, answer }], damit die KI das Gespraech fortsetzen kann */
const askGemini = async (question, apiKey, model = DEFAULT_MODEL, history = []) => {
	const response = await got('Global')({
		url: `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent`,
		method: 'POST',
		headers: { 'x-goog-api-key': apiKey },
		json: {
			systemInstruction: { parts: [{ text: SYSTEM_PROMPT }] },
			contents: [
				...history.flatMap((turn) => [
					{ role: 'user', parts: [{ text: turn.question }] },
					{ role: 'model', parts: [{ text: turn.answer }] },
				]),
				{ role: 'user', parts: [{ text: question }] },
			],
			generationConfig: { maxOutputTokens: 512 },
		},
		timeout: { request: 30_000 },
		retry: { limit: 0 },
	});

	if (response.statusCode === 429) {
		return { error: 'the free AI limit is used up for now, try again later.' };
	}
	if (response.statusCode === 503) {
		return { error: 'the AI is busy right now, try again in a bit.' };
	}
	if (response.statusCode !== 200) {
		console.warn(`[ask] Gemini HTTP ${response.statusCode}: ${JSON.stringify(response.body).slice(0, 300)}`);
		return { error: `the AI didn't answer (status ${response.statusCode}), try again later.` };
	}
	const answer = extractAnswer(response.body);
	if (!answer) {
		return { error: "the AI didn't give an answer to that." };
	}
	return { answer: cleanAnswer(answer) };
};

/**
 * Gemeinsamer Ablauf von !ask und !askc: continueChat = an das laufende Gespraech des Users anhaengen (nur wenn die letzte
 * Frage hoechstens 5 Minuten her ist), sonst neues Gespraech.
 */
const answerQuestion = async (msg, { continueChat }) => {
	const display = msg.displayName;
	const question = msg.args.join(' ').trim();
	if (!question) {
		return { text: `@${display}, Usage: ${msg.invocation} <question>` };
	}
	if (question.length > MAX_QUESTION) {
		return { text: `@${display}, your question is too long (max ${MAX_QUESTION} characters).` };
	}

	const apiKey = process.env.GEMINI_API_KEY;
	if (!apiKey) {
		return { text: `@${display}, the AI isn't set up yet.` };
	}

	const key = String(msg.sender?.id ?? msg.displayName);
	const history = continueChat ? conversations.active(key) : [];
	try {
		const result = await askGemini(question, apiKey, process.env.GEMINI_MODEL || DEFAULT_MODEL, history);
		if (!result.answer) {
			return { text: `@${display}, ${result.error}` };
		}
		conversations.remember(key, question, result.answer, { keep: history.length > 0 });
		const [first, ...followUps] = splitAnswer(result.answer);
		return { text: `@${display}, ${first}`, followUps };
	} catch (e) {
		console.warn(`[ask] ${e instanceof Error ? e.message : e}`);
		return { text: `@${display}, the AI didn't answer, try again later.` };
	}
};

module.exports = {
	name: 'ask',
	aliases: [],
	cooldown: 10_000,
	description: 'Asks an AI (Google Gemini) a question and posts a short answer. Follow up within 5 minutes with askc.',
	usage: 'ask <question>',
	flags: ['cooldown-notice', 'no-prefix', 'external-input'],
	execute: async (client, msg) => await answerQuestion(msg, { continueChat: false }),
};

Object.assign(module.exports, { answerQuestion, extractAnswer, cleanAnswer, splitAnswer, askGemini, SYSTEM_PROMPT });
