const { defineChatModule } = require('../chat-modules.js');
const phrases = require('../../../util/moderation-phrases.js');
const { isBanEvader, isSuspicious } = require('../../../util/low-trust-state.js');
const { announceAutobanCount, announceBan, banUser, targetFromChannel } = require('../../../util/moderation.js');
const { deobfuscate, getHiddenDomains, getLinkSpamReason, isTrustedSender, rolesFromBadges } = require('../../../misc/text-analysis.js');
const spamDomains = require('../../../util/spam-domains.js');
const { formatBanphraseReason, localizeViewbotReason } = require('../../../misc/ban-reason.js');
const { mayBanPhraseHit } = require('../../../misc/phrase-ban-gate.js');

/**
 * Kern der Moderation aus sb-v2: prueft jede Nachricht gegen Banphrases und Link-Spam.
 */

// Puffer fuer ueber zwei Nachrichten gesplittete Phrasen. Vorfall #rakialia01, 07.08.2026:
// "Add me on " / "discord. blaries1" - keine der beiden matcht "add me on discord" allein.
const SPLIT_WINDOW = 30_000;
const lastMessage = new Map();

const rememberMessage = (key, text) => {
	const at = Date.now();
	lastMessage.set(key, { text, at });
	setTimeout(() => {
		if (lastMessage.get(key)?.at === at) {
			lastMessage.delete(key);
		}
	}, SPLIT_WINDOW).unref();
};

// Eskalierende Phrasen: 1. Treffer nur zaehlen, 2. Timeout in Basislaenge, ab dem 3. permanenter Ban.
// Zaehler verfaellt nach 24 h ohne neuen Treffer, reiner In-Memory-Zaehler.
const ESCALATE_IDLE = 24 * 60 * 60 * 1000;
const escalation = new Map();

const bumpEscalation = (key, now = Date.now()) => {
	const previous = escalation.get(key);
	const count = previous && now - previous.at < ESCALATE_IDLE ? previous.count + 1 : 1;
	escalation.set(key, { count, at: now });
	return count;
};

/**
 * Zustand fuer "moderation" im eval (alexmoderat, 05.11.2026: "bei banphrases triggered sowie hier" - pajbots
 * sb.modules.moderation mit banphrasesTriggered und config). Zeiten in Millisekunden.
 */
const getModerationStats = (now = Date.now()) => {
	const { reloadInterval, ...stats } = phrases.getStats();
	return {
		...stats,
		activeEscalations: [...escalation.values()].filter((i) => now - i.at < ESCALATE_IDLE).length,
		config: {
			splitWindow: SPLIT_WINDOW,
			escalateIdle: ESCALATE_IDLE,
			escalateDefaultTimeout: 60,
			maxTimeoutDuration: 1_209_600,
			reloadInterval,
		},
	};
};

module.exports = defineChatModule({
	name: 'banphrase-filter',
	description: 'Bans or times out on moderation banphrase hits and link spam.',
	scope: 'global',
	initialize: async () => {
		await phrases.initialize();
		await spamDomains.initialize();
	},
	handlers: {
		message: async (context) => {
			const { channel, user, message, data } = context;
			const userId = user.twitchId;
			// Der Bot laeuft als alexmoderat: eigene Nachrichten (z. B. "?caddbp ... <phrase>") nie pruefen
			if (!userId || userId === bot.Twitch.selfId || channel.mode !== 'Moderator') {
				return;
			}

			const roles = rolesFromBadges(user.name, data.badges);
			const evader = isBanEvader(userId);
			const suspicious = isSuspicious(userId);
			const trusted = isTrustedSender(roles);

			const lowerMessage = deobfuscate(message.toLowerCase());
			const bufferKey = `${channel.id}:${userId}`;
			const previous = lastMessage.get(bufferKey);
			rememberMessage(bufferKey, lowerMessage);

			// Banphrase-Treffer
			// Immune Phrasen fallen schon in findMatch weg - so greift eine andere passende Phrase noch
			let matched = phrases.findMatch(channel.id, lowerMessage, roles);
			if (!matched && previous && Date.now() - previous.at < SPLIT_WINDOW) {
				// trim() gegen Doppel-Leerzeichen an der Nahtstelle ("add me on " + " discord...")
				matched = phrases.findMatch(channel.id, `${previous.text.trim()} ${lowerMessage.trim()}`, roles);
			}

			if (matched && !trusted) {
				// Diese Nachricht nicht als "previous" an die naechste kleben (Vorfall xliljakie/wtfeon, 17.09.2026:
				// eine harmlose Folgenachricht matchte nur, weil sie an den alten Link-Text angehaengt wurde)
				lastMessage.delete(bufferKey);
				let duration = matched.Duration;

				if (matched.Escalate) {
					const count = bumpEscalation(`${channel.id}:${userId}:${matched.ID}`);
					if (count <= 1) {
						console.log(`[banphrase-filter] ESCALATE (1. Treffer, kein Timeout): ${user.name} in #${channel.name} "${matched.Phrase}"`);
						return;
					}

					duration = count === 2 ? (matched.Duration ?? 60) : null;
				}

				const status = evader ? 'BAN EVADER' : suspicious ? 'SUSPICIOUS' : 'REGULAR';
				phrases.recordHit(matched, channel.id);

				// Nur komischer Name UND juenger als 7 Tage wird gebannt, sonst keine Aktion; Ban-Evader/Verdaechtige immer wie bisher
				if (!evader && !suspicious && !(await mayBanPhraseHit(user.name, userId, matched, phrases.getPreset('sellerbot')?.ID ?? null))) {
					console.warn(`[banphrase-filter] "${matched.Phrase}" von ${user.name} in #${channel.name} - kein komischer Name oder aelter als 7 Tage, keine Aktion`);
					return;
				}

				const localizedReason = localizeViewbotReason(channel.name, matched.Reason || matched.Phrase);
				const reason = formatBanphraseReason(localizedReason, bot.Twitch.selfName);
				const ok = await banUser(targetFromChannel(channel, userId, user.name), { reason, duration, status, automated: true });

				if (ok) {
					console.log(`[banphrase-filter] ${duration ? `TIMEOUT ${duration}s` : 'BAN'} ${user.name} in #${channel.name} [${status}]`);
					await announceBan(channel.name, user.name, localizedReason, duration ?? null);
					await announceAutobanCount(channel);
				}

				return;
			}

			// Gelernte Spam-Domains und absichtlich versteckte Links (alexmoderat, 10.11.2026, Vorfall dovie.tv)
			if (!trusted) {
				const learned = spamDomains.findInMessage(message);
				const hidden = learned ? null : getHiddenDomains(message)[0];
				const domain = learned ?? hidden;
				if (domain) {
					lastMessage.delete(bufferKey);
					const publicReason = learned ? `Spam link (${domain})` : `Hidden link (${domain})`;
					const status = evader ? 'BAN EVADER LINKSPAM' : suspicious ? 'SUSPICIOUS LINKSPAM' : 'REGULAR LINKSPAM';
					const ok = await banUser(targetFromChannel(channel, userId, user.name), {
						reason: formatBanphraseReason(publicReason, bot.Twitch.selfName),
						status,
						automated: true,
					});
					if (learned) {
						spamDomains.recordHit(learned);
					} else {
						// Versteckt gepostete Domain gleich lernen, damit sie auch offen geschrieben greift
						await spamDomains
							.addDomain(hidden, {
								learnedBy: `${bot.Twitch.selfName} (hidden link)`,
								sourceChannel: channel.name,
								sourceUser: user.name,
								sourceMessage: message,
							})
							.catch((e) => console.warn('[banphrase-filter] Spam-Domain speichern fehlgeschlagen', e));
					}

					console.log(`[banphrase-filter] ${learned ? 'Gelernte Spam-Domain' : 'Versteckter Link'} ${domain} von ${user.name} in #${channel.name}`);
					if (ok) {
						await announceBan(channel.name, user.name, publicReason, null);
						await announceAutobanCount(channel);
					}
					return;
				}
			}

			// Link-Spam
			const linkSpam = getLinkSpamReason(message, { isSuspicious: suspicious, isBanEvader: evader, isTrusted: trusted });
			if (!linkSpam) {
				return;
			}

			console.log(`[banphrase-filter] Link-Spam von ${user.name} in #${channel.name}: ${linkSpam.domains.join(', ')}`);
			lastMessage.delete(bufferKey);

			// "best viewers" -> Domains ins sellerbot-Preset lernen
			if (lowerMessage.includes('best viewers')) {
				const preset = phrases.getPreset('sellerbot');
				if (preset) {
					for (const domain of linkSpam.domains) {
						const phrase = domain.toLowerCase().trim();
						if (phrase.length >= 4) {
							await phrases.addPhrase({ preset: preset.ID }, { phrase, reason: 'seller bot', addedBy: bot.Twitch.selfName });
							console.log(`[banphrase-filter] Seller-Domain ins Preset gelernt: ${phrase}`);
						}
					}
				}
			}

			// Einheitlich "Viewbot Services" (ninou2, 13.08.2026), ausser bei ninou2 als "seller bot" lokalisiert
			const localizedReason = localizeViewbotReason(channel.name, 'Viewbot Services');
			const reason = formatBanphraseReason(localizedReason, bot.Twitch.selfName);
			const status = evader ? 'BAN EVADER LINKSPAM' : suspicious ? 'SUSPICIOUS LINKSPAM' : 'REGULAR LINKSPAM';
			const ok = await banUser(targetFromChannel(channel, userId, user.name), { reason, status, automated: true });

			if (ok) {
				await announceBan(channel.name, user.name, localizedReason, null);
				await announceAutobanCount(channel);
			}
		},
	},
});

Object.assign(module.exports, { bumpEscalation, getModerationStats });
