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

/** age = { ageDays } oder null (Alter unbekannt: Name allein entscheidet, wie bisher bannen) */
const shouldBanPhraseHit = (login, age) => {
	if (!isWeirdName(login)) {
		return false;
	}

	return !age || !Number.isFinite(age.ageDays) || age.ageDays < MAX_BAN_AGE_DAYS;
};

/** Fuer die Module: Alter holen und entscheiden */
const mayBanPhraseHit = async (login, userId) => shouldBanPhraseHit(login, await accountAgeDays(userId, { byId: true }));

module.exports = { MAX_BAN_AGE_DAYS, isWeirdName, shouldBanPhraseHit, mayBanPhraseHit };
