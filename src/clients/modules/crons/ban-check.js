const { defineCron } = require('../timers.js');

const { fetchTwitchUser } = require('../../../util/twitch/twitch-utils.js');
const { listSuspended, reactivateChannel, suspendChannel } = require('../../../util/channel-suspension.js');
const { recordModAction } = require('../../../util/moderation.js');
const { getBanStatusBatch } = require('../../../misc/twitch-gql.js');

/**
 * Erkennt Twitch-seitige Sperren der Channels, in denen der Bot ist, aus sb-v2s crons/ban-check. Polling, weil Twitch
 * dafuer nachweislich keinen Push liefert (IRC, Hermes und EventSub-Revocation blieben bei Deaktivierung, Ban und
 * Loeschung stumm); Twitchs eigenes Frontend pollt GQL alle ~25 s. Gesperrte Channels werden verlassen (Mode
 * Inactive, siehe singletons/channel-suspension.ts), reaktivierte sofort wieder betreten.
 * In sb-v2 nur fuer einen Prozess erlaubt (zwei Bots parten sich sonst gegenseitig) - der selfbot verwaltet nur
 * seine eigenen Channels.
 */
const BATCH_SIZE = 50;
const STRIKES_TO_LEAVE = 15; // 15 x 10 s ~ 2,5 min Puffer gegen GQL-Aussetzer
const STARTUP_GRACE = 180_000;
const REASON_MAP = {
	DEACTIVATED: 'deactivated',
	TOS_INDEFINITE: 'TOS',
	TOS_TEMPORARY: 'TOS',
	TOS: 'TOS',
	DMCA: 'DMCA',
};

const startedAt = Date.now();
const missingStrikes = new Map();

/** Login loest nicht auf -> erst nach mehreren Bestaetigungen und Helix-Gegenprobe (per ID: Umbenennung erkennen) */
const handleMissing = async (channel) => {
	const strikes = (missingStrikes.get(channel.id) ?? 0) + 1;
	missingStrikes.set(channel.id, strikes);
	if (strikes < STRIKES_TO_LEAVE) {
		return `${channel.name}(${strikes}/${STRIKES_TO_LEAVE})`;
	}

	missingStrikes.delete(channel.id);
	const user = channel.twitchId ? await fetchTwitchUser(channel.twitchId, { byId: true }).catch(() => null) : null;
	if (user) {
		if (user.login !== channel.name) {
			console.warn(`[ban-check] #${channel.name} heisst jetzt ${user.login} - Name nachgezogen`);
			await bot.Channels.saveProperty(channel, 'Name', user.login);
		}
		return null;
	}

	console.warn(`[ban-check] #${channel.name} existiert nicht mehr (GQL + Helix bestaetigt), verlasse`);
	await suspendChannel(channel, 'user_renamed_or_deleted');
	return null;
};

module.exports = defineCron({
	name: 'ban-check',
	expression: '*/10 * * * * *',
	description: 'Checks all channels for Twitch bans via a GQL batch and rejoins reactivated ones.',
	code: async function banCheck() {
		if (Date.now() - startedAt < STARTUP_GRACE) {
			return;
		}

		const platform = bot.Twitch;
		const own = platform.selfName.toLowerCase();
		const joined = bot.Channels.getJoinable().filter((i) => i.Name !== own);
		const suspended = (await listSuspended(platform)).map((i) => i.channel);
		const list = [...joined, ...suspended];

		for (let i = 0; i < list.length; i += BATCH_SIZE) {
			const chunk = list.slice(i, i + BATCH_SIZE);
			let results;
			try {
				results = await getBanStatusBatch(chunk.map((item) => item.Name));
			} catch {
				continue; // Netzwerkaussetzer -> Batch ueberspringen, kein Strike
			}

			const waiting = [];
			for (const channel of chunk) {
				const info = results.get(channel.name) ?? null;
				const isSuspended = suspended.includes(channel);
				try {
					if (!info || (info.banned && info.banReason === 'UNKNOWN')) {
						const strike = isSuspended ? null : await handleMissing(channel);
						if (strike) {
							waiting.push(strike);
						}
						continue;
					}

					missingStrikes.delete(channel.id);
					if (info.banned && !isSuspended) {
						const raw = String(info.banReason ?? '').toUpperCase();
						const reason = REASON_MAP[raw] ?? (raw || 'TOS');
						console.warn(`[ban-check] #${channel.name} gebannt (Twitch-Ban, Grund: ${reason}), verlasse`);
						recordModAction({
							type: 'ban',
							username: channel.name,
							userId: channel.twitchId,
							channelName: channel.name,
							channel,
							reason,
							status: 'TWITCH_PLATFORM_BAN',
							modName: 'twitch',
						});
						await suspendChannel(channel, reason);
					} else if (!info.banned && isSuspended && (await reactivateChannel(channel, platform))) {
						console.log(`[ban-check] #${channel.name} wieder aktiv, Auto-Rejoin`);
					}
				} catch (e) {
					console.warn(`[ban-check] Fehler fuer #${channel.name}`, e);
				}
			}

			if (waiting.length > 0) {
				console.warn(`[ban-check] ${waiting.length} Channel(s) nicht gefunden, warte auf Bestaetigung: ${waiting.join(', ')}`);
			}
		}
	},
});
