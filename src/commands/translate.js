const { got } = require('../token/got.js');
const { resolveLanguage } = require('../util/languages.js');

/**
 * Uebersetzen, aus sb-v2 (Block 7: sb-v2-Version). Google wie Supibot ueber client=dict-chrome-ex mit Chrome-User-Agent
 * (alexmoderat, 15.10.2026: "meins spinnt naemlich immer wieder mal" - gtx wird oefter geblockt), DeepL als zweite
 * Engine mit eigenem Schluessel (DEEPL_API_KEY, sb-v2: config.deeplApiKey). Antwortformat "[de → en] text" wie der
 * alte translate (alexmoderat, 15.10.2026: "mach bitte sowie der alte translate cmd").
 */
const GOOGLE_URL = 'https://clients5.google.com/translate_a/t';
const GOOGLE_USER_AGENT = 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36';

const translateGoogle = async (text, from, to) => {
	const response = await got('GenericAPI')({
		url: GOOGLE_URL,
		searchParams: { client: 'dict-chrome-ex', dt: 't', ie: 'UTF-8', oe: 'UTF-8', sl: from, tl: to, q: text },
		headers: { 'User-Agent': GOOGLE_USER_AGENT },
		timeout: { request: 6000 },
	});
	return parseGoogleResult(response.body, from);
};

/** Antwort ist [text] (Quelle == Ziel) oder [[text, erkannteSprache]] - wie Supibots resultSchema */
const parseGoogleResult = (data, from) => {
	const first = Array.isArray(data) ? data[0] : undefined;
	if (Array.isArray(first)) {
		return { translated: String(first[0]), detectedLang: String(first[1]) };
	}
	return { translated: String(first ?? ''), detectedLang: from };
};

const translateDeepl = async (text, from, to, formality, apiKey) => {
	const response = await got('Global')({
		url: 'https://api-free.deepl.com/v2/translate',
		headers: { Authorization: `DeepL-Auth-Key ${apiKey}` },
		searchParams: {
			text,
			target_lang: to.toUpperCase(),
			...(from ? { source_lang: from.toUpperCase() } : {}),
			...(formality ? { formality } : {}),
		},
		timeout: { request: 8000 },
	});

	// DeepL nutzt 456 statt 429 fuer "Monatskontingent aufgebraucht"
	if (response.statusCode === 456) {
		throw new Error('monthly DeepL quota exhausted, try again next billing period');
	}
	if (response.statusCode !== 200) {
		throw new Error(`DeepL API error (status ${response.statusCode})`);
	}

	const [t] = response.body.translations;
	return { translated: String(t.text), detectedLang: String(t.detected_source_language).toLowerCase() };
};

/** Woerter -> Engine/Sprachen/Text; error ist die fertige Antwort ohne "@user, " */
const parseTranslateArgs = (words, invocation) => {
	let engine = invocation === 'deepl' ? 'deepl' : 'google';
	let targetLang = 'en';
	let fromLang = null;
	let formality = null;
	let toWasKeyed = false;
	const rest = [];

	for (const word of words) {
		const engineMatch = /^engine:(.+)$/i.exec(word);
		const toMatch = /^(?:to|lang|language):(.+)$/i.exec(word);
		const fromMatch = /^from:(.+)$/i.exec(word);
		const formalityMatch = /^formality:(.+)$/i.exec(word);

		if (engineMatch) {
			if (invocation === 'deepl') {
				return { error: `don't use both the "deepl" alias and the engine parameter.` };
			}
			const wanted = engineMatch[1].toLowerCase();
			if (wanted !== 'google' && wanted !== 'deepl') {
				return { error: `unknown engine "${wanted}". Use "google" or "deepl".` };
			}
			engine = wanted;
		} else if (toMatch) {
			const lang = resolveLanguage(toMatch[1]);
			if (!lang) {
				return { error: `unknown language "${toMatch[1]}".` };
			}
			targetLang = lang;
			toWasKeyed = true;
		} else if (fromMatch) {
			const lang = resolveLanguage(fromMatch[1]);
			if (!lang) {
				return { error: `unknown language "${fromMatch[1]}".` };
			}
			fromLang = lang;
		} else if (formalityMatch) {
			formality = formalityMatch[1].toLowerCase();
		} else {
			rest.push(word);
		}
	}

	// ninou2, 03.10.2026: erstes Wort als Zielsprache, wenn noch Text folgt und to: nicht benutzt wurde
	const leading = !toWasKeyed && rest.length > 1 ? resolveLanguage(rest[0]) : null;
	if (leading) {
		targetLang = leading;
		rest.shift();
	}

	if (formality && engine !== 'deepl') {
		return { error: `you can't use "formality" with Google! Use DeepL by adding "engine:deepl".` };
	}

	return { engine, targetLang, fromLang, formality, text: rest.join(' ').trim() };
};

module.exports = {
	name: 'translate',
	aliases: ['tl', 'deepl'],
	cooldown: 3000,
	description: 'Translates text. Default engine: Google (free). "engine:deepl" or the deepl alias uses DeepL instead (supports formality:more|less). Without a language: to English.',
	usage: 'translate [language | to:language] [from:language] [engine:google|deepl] [formality:more|less] <text>',
	flags: ['mod'],
	execute: async (client, msg) => {
		const words = [...msg.args];
		const display = msg.displayName;
		const usage = `@${display}, Usage: ${msg.invocation} [language | to:language] <text>`;
		if (words.length === 0) {
			return { text: usage };
		}

		const args = parseTranslateArgs(words, msg.invocation);
		if ('error' in args) {
			return { text: `@${display}, ${args.error}` };
		}
		if (!args.text) {
			return { text: usage };
		}

		try {
			let result;
			if (args.engine === 'deepl') {
				const apiKey = process.env.DEEPL_API_KEY;
				if (!apiKey) {
					throw new Error('DeepL is not configured (missing DEEPL_API_KEY)');
				}
				result = await translateDeepl(args.text, args.fromLang, args.targetLang, args.formality, apiKey);
			} else {
				result = await translateGoogle(args.text, args.fromLang ?? 'auto', args.targetLang);
			}

			return { text: `@${display}, [${result.detectedLang} → ${args.targetLang}] ${result.translated}` };
		} catch (e) {
			const message = e instanceof Error ? e.message : '';
			console.warn(`[translate] ${message}`);
			return { text: `@${display}, Translation failed${message ? ` (${message})` : ''}.` };
		}
	},
};

Object.assign(module.exports, { parseGoogleResult, parseTranslateArgs });
