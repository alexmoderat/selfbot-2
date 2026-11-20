const sbv2 = require('../database/sbv2.js');

const { autoBan, targetFromChannel } = require('./moderation.js');
const { formatAutoBanReason } = require('../misc/ban-reason.js');
const { deobfuscate, getUniqueDomains, isAllowlistedDomain, isTrustedSender, rolesFromBadges } = require('../misc/text-analysis.js');
const { accountAgeDays } = require('../misc/twitch-lists.js');
const { COMBINE_CATEGORIES, COMBINE_WINDOW, MIN_GAP, NEW_ACCOUNT_MAX_AGE, WINDOW, collapseUnambiguousTlds } = require('../misc/network-bot-rules.js');

// Gemeinsame Ausfuehrung der CatQuery-Muster-Module, aus sb-v2s v2/utils/network-bot-detector.ts. Jede Regel hat
// einen eigenen Namensraum in Normalized_Text ("fm::", "vb::", ...), damit sich die Kategorien nicht gegenseitig
// die Sichtungszahlen verfaelschen.

// dc/sm: letzte Nachricht pro User+Channel, fuer ueber zwei Nachrichten gesplittete Ansprachen
const lastMessages = new Map();

/**
 * Sichtungen, die zaehlen. "fm" hat kein Muster und trifft jeden Text - dort zaehlt nur der SELBE Account
 * (fynn251617, 25.09.2026: "hi" kam von 127 echten Accounts in 148 Channels und bannte jeden Neuling).
 * Die Kategorien mit Muster zaehlen bewusst ueber Accounts hinweg: dasselbe Bot-Netz nutzt viele Accounts.
 */
const countChannels = async (rule, key, userId) => {
	const cutoff = new Date(Date.now() - WINDOW);
	const byUser = rule.category === 'fm';
	const rows = await sbv2.query(
		`SELECT COUNT(DISTINCT channel) AS Count FROM chat_data.first_message_sightings WHERE normalized_text = ? AND seen_at >= ?${byUser ? ' AND user_id = ?' : ''}`,
		byUser ? [key, cutoff, userId] : [key, cutoff],
	);
	return Number(rows[0]?.Count ?? 0);
};

/** Sichtung speichern - ausser dieselbe Nachricht kam binnen 5 s schon (Shared-Chat-Duplikat, CatQuery-Vorgabe) */
const recordSighting = async (key, userId, channelName) => {
	const [row] = await sbv2.query(
		'SELECT seen_at AS Seen_At FROM chat_data.first_message_sightings WHERE normalized_text = ? AND user_id = ? ORDER BY seen_at DESC LIMIT 1',
		[key, userId],
	);
	const last = row?.Seen_At ?? null;

	if (last && Date.now() - Number(last.valueOf()) < MIN_GAP) {
		return false;
	}

	await sbv2.query('INSERT INTO chat_data.first_message_sightings (normalized_text, user_id, channel) VALUES (?, ?, ?)', [key, userId, channelName]);
	return true;
};

/** Schluessel der Sichtung oder null, wenn die Nachricht nicht in die Kategorie passt */
const sightingKey = (rule, message, combined) => {
	if (COMBINE_CATEGORIES.has(rule.category)) {
		const hit = Boolean(rule.pattern?.test(message)) || Boolean(combined && rule.pattern?.test(combined));
		if (!hit) {
			return null;
		}
	} else if (rule.category !== 'vb' && rule.pattern && !rule.pattern.test(message)) {
		// "vb" prueft weiter unten selbst, gegen die normalisierte Nachricht ("streamerbeat com" ohne Punkt)
		return null;
	}

	const normalized = deobfuscate(message.toLowerCase()).trim();
	if (!normalized) {
		return null;
	}

	if (rule.category === 'vb') {
		// Allowlist beachten ("check out twitch.tv/xyz" ist kein Viewbot-Seller, #tuffik1998, 24.08.2026) und nach
		// Domain statt Text gruppieren - Seller variieren den Wortlaut, der beworbene Dienst bleibt (30.08.2026)
		const domains = getUniqueDomains(collapseUnambiguousTlds(message));
		if (domains.length === 0 || domains.every((i) => isAllowlistedDomain(i))) {
			return null;
		}

		return `vb::${domains.sort().join(',')}`.slice(0, 500);
	}

	// Normalized_Text ist VARCHAR(500) inkl. Praefix
	return `${rule.category}::${normalized.slice(0, 490)}`;
};

const runNetworkBotCheck = async (context, rule) => {
	const { channel, user, message, data, platform } = context;
	const userId = user.twitchId;
	if (!userId || userId === platform.selfId || channel.mode !== 'Moderator') {
		return;
	} else if (isTrustedSender(rolesFromBadges(user.name, data.badges))) {
		return;
	}

	const combineThis = COMBINE_CATEGORIES.has(rule.category);
	const mapKey = `${channel.id}:${userId}`;
	const previous = lastMessages.get(mapKey);
	const combined = previous && Date.now() - previous.at <= COMBINE_WINDOW ? `${previous.text} ${message}` : null;

	// dc/sm bleiben auch fuer die zweite Nachricht in Betracht, alle anderen nur bei der allerersten
	if (!data.isFirstMessage && !(combineThis && combined)) {
		return;
	}
	if (combineThis) {
		lastMessages.set(mapKey, { text: message, at: Date.now() });
		if (lastMessages.size > 10_000) {
			lastMessages.clear();
		}
	}
	if (data.badges.length > 0) {
		return;
	}

	const key = sightingKey(rule, message, combined);
	if (!key || !(await recordSighting(key, userId, channel.name))) {
		return;
	}

	const channelCount = Number((await countChannels(rule, key, userId)) ?? 0);
	if (channelCount < rule.minChannelsNewAccount) {
		return;
	}

	let threshold = rule.minChannelsDefault;
	if (channelCount < rule.minChannelsDefault) {
		const age = await accountAgeDays(userId, { byId: true });
		const isNewAccount = age !== null && age.ageDays * 86_400_000 <= NEW_ACCOUNT_MAX_AGE;
		threshold = isNewAccount ? rule.minChannelsNewAccount : rule.minChannelsDefault;
	}
	if (channelCount < threshold) {
		return;
	}

	console.warn(`[network-bot] ${rule.category}: ${user.name} in #${channel.name} - "${message}" (${channelCount} Channels, Schwelle ${threshold})`);
	await autoBan(targetFromChannel(channel, userId, user.name), {
		reason: formatAutoBanReason(rule.reasonLabel, platform.selfName),
		publicReason: rule.reasonLabel,
		status: rule.category.toUpperCase(),
	});
};

module.exports = { sightingKey, runNetworkBotCheck };
