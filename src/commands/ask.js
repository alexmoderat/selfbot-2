const { got } = require('../token/got.js');

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
const SYSTEM_PROMPT =
	'You are a helpful bot in a Twitch chat. Answer as briefly as the question allows: simple questions in one or two ' +
	'sentences, never more than 1000 characters, ' +
	'in the same language as the question. Plain text only: no markdown, no lists, no line breaks, no links.';

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

const askGemini = async (question, apiKey, model = DEFAULT_MODEL) => {
	const response = await got('Global')({
		url: `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent`,
		method: 'POST',
		headers: { 'x-goog-api-key': apiKey },
		json: {
			systemInstruction: { parts: [{ text: SYSTEM_PROMPT }] },
			contents: [{ role: 'user', parts: [{ text: question }] }],
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

module.exports = {
	name: 'ask',
	aliases: [],
	cooldown: 10_000,
	description: 'Asks an AI (Google Gemini) a question and posts a short answer.',
	usage: 'ask <question>',
	flags: ['cooldown-notice', 'no-prefix', 'external-input'],
	execute: async (client, msg) => {
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

		try {
			const result = await askGemini(question, apiKey, process.env.GEMINI_MODEL || DEFAULT_MODEL);
			if (!result.answer) {
				return { text: `@${display}, ${result.error}` };
			}
			const [first, ...followUps] = splitAnswer(result.answer);
			return { text: `@${display}, ${first}`, followUps };
		} catch (e) {
			console.warn(`[ask] ${e instanceof Error ? e.message : e}`);
			return { text: `@${display}, the AI didn't answer, try again later.` };
		}
	},
};

Object.assign(module.exports, { extractAnswer, cleanAnswer, splitAnswer, askGemini, SYSTEM_PROMPT });
