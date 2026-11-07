const { randomBytes } = require('node:crypto');
const { gqlAuth, getUserInfo } = require('../misc/twitch-gql.js');

// Meldegruende aus sb-v2 (src/services/twitch-api.ts reportTwitchUser)
const REPORT_REASON_ALIASES = {
	spam: 'spam',
	viewbot: 'spam',
	viewbotting: 'spam',
	viewership: 'spam',
	tampering: 'spam',
	fake_live: 'spam',
	harassment: 'harassment',
	hate: 'hateful_conduct',
	hateful: 'hateful_conduct',
	slurs: 'hateful_conduct',
	sexual: 'sexual_content',
	nudity: 'sexual_content',
	selfharm: 'selfharm',
	self_harm: 'selfharm',
	terrorism: 'terrorism_mass_violence',
	violence: 'terrorism_mass_violence',
	gore: 'gore',
	underage: 'underaged',
	impersonation: 'impersonation',
	impersonate: 'impersonation',
	misinformation: 'misinformation',
	harm: 'harm',
	ban_evasion: 'tos_ban_evasion',
	ban_evader: 'tos_ban_evasion',
	evasion: 'tos_ban_evasion',
	chat_ban: 'tos_ban_evasion',
	ip: 'ip_violation',
	bits: 'bits_violation',
};
const VALID_REASON_IDS = new Set(Object.values(REPORT_REASON_ALIASES));
// Untergruppen von "spam" aus der Meldemaske (20.09.2026); diese Aliase melden den LIVESTREAM statt einer Chat-Nachricht
const DETAIL_ALIASES = {
	viewbot: 'viewership_tampering',
	viewbotting: 'viewership_tampering',
	viewership: 'viewership_tampering',
	tampering: 'viewership_tampering',
	// Bot-Farm-Accounts, die einen aufgezeichneten Clip als "live" ausgeben (30.09.2026)
	fake_live: 'bots',
};
const LIVESTREAM_REASONS = new Set(Object.keys(DETAIL_ALIASES));
const DETAILED_REASON_MAP = {
	spam: 'scam',
	hateful_conduct: 'slurs_symbols',
	harassment: 'targeted_abuse',
	sexual_content: 'sexually_explicit',
	selfharm: 'intentional_self_harm',
	harm: 'swatting',
};

module.exports = {
	name: 'report',
	aliases: ['lr'],
	cooldown: 3000,
	description:
		'Reports a user to Twitch. Reasons include: spam, harassment, hate, slurs, sexual, selfharm, terrorism, violence, gore, underage, impersonation, misinformation, harm, cheating, ban_evasion, evasion, ip, viewbot (reports the live stream for viewership tampering), fake_live (reports the live stream as a bot)',
	usage: 'report <user> reason:<reason>',
	flags: ['mod'],
	params: [{ name: 'reason', type: 'string' }],
	execute: async (client, msg) => {
		const [targetRaw] = msg.args;
		const display = msg.displayName;
		if (!process.env.TWITCH_WEB_TOKEN) {
			return { text: `@${display}, webToken not configured.` };
		}

		const target = (targetRaw ?? '').toLowerCase().replace('@', '');
		const input = msg.params.reason?.replace(/^["']|["']$/g, '').toLowerCase();
		if (!input) {
			return { text: `@${display}, Usage: ${msg.prefix}${msg.invocation} <user> reason:<reason>` };
		}

		const reasonId = REPORT_REASON_ALIASES[input] ?? (VALID_REASON_IDS.has(input) ? input : null);
		if (!reasonId) {
			return { text: `@${display}, report failed: invalid reason. Valid reasons: ${Object.keys(REPORT_REASON_ALIASES).join(', ')}` };
		}

		const userInfo = await getUserInfo(target).catch(() => null);
		if (!userInfo?.id) {
			return { text: `@${display}, user "${target}" not found.` };
		}

		// Livestream-Meldung: der Channel ist der des gemeldeten Users, nicht der Chat hier
		const channelId = LIVESTREAM_REASONS.has(input) ? userInfo.id : (msg.channelData?.twitchId ?? '');
		const detailedReason = DETAIL_ALIASES[input] ?? DETAILED_REASON_MAP[reasonId] ?? '';
		const contentType = LIVESTREAM_REASONS.has(input) ? 'LIVESTREAM_REPORT' : 'CHAT_REPORT';
		const sessionId = randomBytes(16).toString('hex');

		const mutation = `
			mutation ReportWizard_CreateReport {
				reportUserContent(input: {
					content: ${contentType},
					contentMetadata: { channelID: ${JSON.stringify(channelId)} },
					description: "",
					detailedReason: ${JSON.stringify(detailedReason)},
					dsaArgs: { reporterEmail: "" },
					reason: ${JSON.stringify(reasonId)},
					sessionID: ${JSON.stringify(sessionId)},
					targetUserID: ${JSON.stringify(userInfo.id)},
					uiEntryPoint: "moderation_user_details"
				}) {
					error { __typename }
				}
			}`;

		try {
			const data = await gqlAuth({ query: mutation, variables: {} });
			const error = data.reportUserContent?.error;
			if (error) {
				return { text: `@${display}, report failed: ${error.__typename ?? 'unknown error'}` };
			}
		} catch (e) {
			return { text: `@${display}, report failed: ${e.message}` };
		}

		return {
			text: `@${display}, report sent. details ⇒ channelID: ${channelId} · targetUserID: ${userInfo.id} · reason: ${reasonId} · detailedReason: ${detailedReason}`,
		};
	},
};
