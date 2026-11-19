const { accountAgeDays } = require('./twitch-lists.js');

/**
 * Banphrase-Treffer bannen nur noch, wenn der Account einen komischen Namen hat UND juenger als 7 Tage ist; sonst keine
 * Aktion (kein Ban, kein Loeschen, kein Ablehnen). alexmoderat, 15.11.2026: Reksua10 (Konto seit 2024) zitierte einen
 * Spam-Satz im Spass, zweiter Fehlalarm - "nur die komische namen haben und nur juenger als 7d sind ban, aeltere bleibt".
 */
const MAX_BAN_AGE_DAYS = 7;

/**
 * "Komischer" Name = wie ein generierter/zufaelliger Spam-Name: lang (ab 10 Zeichen), mehrere Ziffern oder eine Ziffer
 * mitten im Namen ("needymanagementc0ph", "ghostshaman3767", "luckychateauqjy032"). Kurze, normale Namen nicht.
 */
const isWeirdName = (login) => {
	const name = String(login ?? '').toLowerCase();
	return name.length >= 10 || /\d{2,}/.test(name) || /[a-z]\d[a-z]/.test(name);
};

/**
 * Generierter Bot-Name: sehr lang (ab 18 Zeichen), nur Kleinbuchstaben und Ziffern, kein Unterstrich ("vindictiveordinanceomvs",
 * "angelicbacklogpkdh4": mehrere Woerter plus Zufallsende). Solche Konten werden in Chargen angelegt (alle am 29.10.2026) und sind
 * nach wenigen Wochen noch Bots, deshalb ohne Altersgrenze (alexmoderat, 16.11.2026: "mach variante 3").
 */
const isGeneratedBotName = (login) => /^[a-z][a-z0-9]{17,}$/.test(String(login ?? '').toLowerCase());

/**
 * Viewbot-/Seller-Phrase (Grund "Viewbot Service(s)"/"seller bot" oder Phrase im sellerbot-Preset): immer bannen, ohne Namens-
 * und Altersregel (Mods/VIPs/Subs/Broadcaster sind schon vorher ausgenommen). alexmoderat, 19.11.2026: fleetingax12h (Konto
 * 20 Tage alt, "Best viewers with streamboo .com" in #im_row1) und cut_rateredistribution8 rutschten durch die 7-Tage-Regel -
 * "ja, ohne Altersgrenze", ein 2 Jahre altes Konto hatte schon einen streamboo-Spamsatz geschrieben, "das war sogar n normaler
 * name". Bewusst in Kauf genommen: wer so einen Satz im Spass zitiert (Reksua10, 15.11.), wird wieder gebannt.
 */
const VIEWBOT_REASON = /^(viewbot services?|seller ?bot)$/i;
const isViewbotPhrase = (matched, sellerPresetId = null) =>
	Boolean(matched) && (VIEWBOT_REASON.test(String(matched.Reason ?? '').trim()) || (sellerPresetId !== null && matched.Preset === sellerPresetId));

/** age = { ageDays } oder null (Alter unbekannt: Name allein entscheidet, wie bisher bannen); viewbot = Viewbot-Phrase */
const shouldBanPhraseHit = (login, age, viewbot = false) => {
	if (isGeneratedBotName(login)) {
		return true;
	} else if (viewbot) {
		return true;
	} else if (!isWeirdName(login)) {
		return false;
	}

	return !age || !Number.isFinite(age.ageDays) || age.ageDays < MAX_BAN_AGE_DAYS;
};

/** Fuer die Module: Alter holen und entscheiden */
const mayBanPhraseHit = async (login, userId, matched = null, sellerPresetId = null) => {
	const viewbot = isViewbotPhrase(matched, sellerPresetId);
	if (viewbot || isGeneratedBotName(login)) {
		return true;
	}
	return shouldBanPhraseHit(login, await accountAgeDays(userId, { byId: true }), viewbot);
};

module.exports = { MAX_BAN_AGE_DAYS, isWeirdName, isGeneratedBotName, isViewbotPhrase, shouldBanPhraseHit, mayBanPhraseHit };
