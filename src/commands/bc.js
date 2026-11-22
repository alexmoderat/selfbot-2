const { Logger } = require('../misc/logger.js');
const { got } = require('../token/got.js');
const { formatDuration } = require('../misc/humanizeDuration.js');
const { gqlAuth, getUserInfo } = require('../token/gql.js');

const BAN_STATUS_HASH = '319f2a9a3ac7ddecd7925944416c14b818b65676ab69da604460b68938d22bea';

/**
 * Ist der Aufrufer in einem fremden Channel gebannt? (aus sb-v2) Zwei Wege, weil keiner allein reicht:
 *   Helix /moderation/banned   nur wo der Bot Mod oder Broadcaster ist
 *   GQL ChatRoomBanStatus      ueberall, braucht aber den Web-Token
 */
const command = {
	name: 'bc',
	cooldown: { user: 3 },
	access: { channel: 2 },
	description: 'Checks whether you are banned in a channel.',
	usage: 'bc <channel>',
	execute: async ({ client, message: msg }) => {
		const [targetRaw] = msg.args;
		const display = msg.displayName;
		const target = (targetRaw ?? '')
			.toLowerCase()
			.replace(/^[@#]+/, '')
			.trim();
		const senderId = msg.sender.twitchId;
		if (!senderId) {
			return `@${display}, could not resolve your user ID.`;
		}

		// Fuer nie existierende Logins antwortet GQL mit "gesperrt" ohne ID - vorher ergab das "du bist nicht gebannt"
		const channelInfo = await getUserInfo(target);
		if (!channelInfo?.id) {
			return `@${display}, channel "${target}" not found.`;
		}

		let ban = null;
		const helix = await got('Helix')({
			url: 'moderation/banned',
			searchParams: { broadcaster_id: channelInfo.id, user_id: senderId },
		});

		if (helix.ok) {
			const row = helix.body.data?.[0];
			ban = row ? { createdAt: row.created_at, expiresAt: row.expires_at || null, reason: row.reason, moderator: row.moderator_login } : null;
		} else if (helix.statusCode !== 401 && helix.statusCode !== 403) {
			return `@${display}, error ${helix.statusCode}: ${helix.body.message ?? 'unknown error'}`;
		} else {
			// Kein Mod dort -> GQL
			try {
				const data = await gqlAuth({
					operationName: 'ChatRoomBanStatus',
					variables: { channelID: channelInfo.id, targetUserID: senderId },
					extensions: { persistedQuery: { version: 1, sha256Hash: BAN_STATUS_HASH } },
				});

				const status = data.chatRoomBanStatus;
				ban = status
					? {
							createdAt: status.createdAt,
							expiresAt: status.expiresAt,
							reason: status.reason,
							moderator: status.moderator?.login ?? status.bannedBy?.login ?? null,
						}
					: null;
			} catch (e) {
				Logger.warn('[bc] GQL-Rueckfall fehlgeschlagen', e);
				return `@${display}, can't check ban status in ${channelInfo.displayName} — not a mod there and the GQL fallback failed.`;
			}
		}

		if (!ban) {
			return `@${display}, you are not banned in ${channelInfo.displayName}.`;
		}

		const bannedAt = ban.createdAt ? new Date(ban.createdAt) : null;
		const expiresAt = ban.expiresAt ? new Date(ban.expiresAt) : null;
		let duration = 'permanently';
		if (expiresAt) {
			const remaining = expiresAt.getTime() - Date.now();
			duration = remaining > 0 ? `for ${formatDuration(remaining)} more` : 'expired';
		}

		const by = ban.moderator ? ` by ${ban.moderator}` : '';
		const created = bannedAt
			? ` Created: ${bannedAt
					.toISOString()
					.replace('T', ' ')
					.replace(/\.\d+Z$/, ' UTC')} (${formatDuration(Date.now() - bannedAt.getTime())} ago).`
			: '';

		return `@${display}, Banned in ${channelInfo.displayName} ${duration}${by}.${created} Reason: "${ban.reason || '—'}"`;
	},
};

module.exports = { command };
