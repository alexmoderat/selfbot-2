const cron = require('node-cron');

// Chat-Logging wie Supibots singletons/logger.ts (push, updateLastSeen, Takte aus Supibots config-default):
// - "Lines": jede Nachricht in chatLines (channel, userId = Twitch-User-ID, text, posted), gesammelt und jede Minute
//   geschrieben (bisher eine Tabelle je Channel in selfbot_chat_line)
// - "Meta": messageMetaUserAlias (Nachrichtenzahl, erste/letzte Nachricht), alle 5 Minuten per Upsert
// alexmoderat, 23.10.2026: "Supibot-Modell".

const LINES_CRON = '0 * * * * *';
const META_CRON = '0 */5 * * * *';
// Supibot: loggingWarnLimit - ein Channel mit mehr Zeilen pro Takt wird verworfen statt die DB zu fluten
const WARN_LIMIT = 2500;

class ChatLogger {
	#lines = new Map(); // channelId -> [{ channel, userId, text, posted }]
	#lastSeen = new Map(); // channelId -> Map(userId -> { message, count, date, firstMessage, firstDate })
	#lastSeenUser = new Map();
	#tasks = [];
	#metaRunning = false;
	#started = false;

	start() {
		if (this.#started) {
			return;
		}
		this.#started = true;
		this.#tasks.push(
			cron.schedule(LINES_CRON, () => this.#storeLines()),
			cron.schedule(META_CRON, () => void this.#storeMeta()),
		);
	}

	/** Nachricht fuer chatLines einreihen (nur Channels mit Logging "Lines") */
	push(message, user, channel) {
		// Parallelbetrieb: der alte selfbot loggt dieselben Zeilen, die Migration uebernimmt sie spaeter
		if (bot.Config.parallelMode || !channel.logging.has('Lines')) {
			return;
		}
		let list = this.#lines.get(channel.id);
		if (!list) {
			list = [];
			this.#lines.set(channel.id, list);
		}
		list.push({ channel: channel.id, userId: user.twitchId ?? user.name, text: message, posted: new Date() });
	}

	/** Meta-Daten (letzte Nachricht, Zaehler) fuer messageMetaUserAlias vormerken */
	updateLastSeen({ channel, user, message }) {
		if (bot.Config.parallelMode || !channel.logging.has('Meta')) {
			return;
		}

		let map = this.#lastSeen.get(channel.id);
		if (!map) {
			map = new Map();
			this.#lastSeen.set(channel.id, map);
		}

		const now = new Date();
		const text = message.slice(0, 2000);
		const previous = map.get(user.id);
		this.#lastSeenUser.set(user.id, now.valueOf());
		// first*: erste Nachricht dieses Pakets (Supibots Trigger trug die LETZTE als erste ein)
		map.set(user.id, {
			message: text,
			count: (previous?.count ?? 0) + 1,
			date: now,
			firstMessage: previous?.firstMessage ?? text,
			firstDate: previous?.firstDate ?? now,
		});
	}

	/** Zuletzt gesehen laut Speicher (noch nicht geschrieben); null, wenn seit dem Start nichts kam */
	getUserLastSeen(userId) {
		const value = this.#lastSeenUser.get(userId);
		return value ? new Date(value) : null;
	}

	#storeLines() {
		let i = 0;
		for (const [channelId, list] of this.#lines) {
			if (list.length === 0) {
				continue;
			}
			const records = list.splice(0, list.length);
			if (records.length > WARN_LIMIT) {
				const channel = bot.Channels.get(channelId);
				console.warn(`[chat-logger] #${channel?.name ?? channelId} ueber dem Limit: ${records.length}/${WARN_LIMIT} - verworfen`);
				continue;
			}
			// Zeitversetzt, damit nicht alle Channels gleichzeitig schreiben (wie Supibot)
			setTimeout(
				() =>
					void bot.DB.ChatLine.insertMany(records, { ordered: false }).catch((e) => console.warn('[chat-logger] Zeilen schreiben fehlgeschlagen', e)),
				i * 250,
			);
			i++;
		}
	}

	async #storeMeta() {
		if (this.#metaRunning) {
			return;
		}

		this.#metaRunning = true;
		try {
			const ops = [];
			for (const [channelId, userMap] of this.#lastSeen) {
				for (const [userId, entry] of userMap) {
					ops.push({
						updateOne: {
							filter: { userAlias: userId, channel: channelId },
							update: {
								$inc: { messageCount: entry.count },
								$set: { lastMessagePosted: entry.date, lastMessageText: entry.message },
								// erste Nachricht nur beim Anlegen (wie der MariaDB-Trigger)
								$setOnInsert: { firstMessagePosted: entry.firstDate, firstMessageText: entry.firstMessage },
							},
							upsert: true,
						},
					});
				}
				userMap.clear();
			}

			if (ops.length > 0) {
				await bot.DB.MessageMetaUserAlias.bulkWrite(ops, { ordered: false });
			}
		} catch (e) {
			console.warn('[chat-logger] Meta schreiben fehlgeschlagen', e);
		} finally {
			this.#metaRunning = false;
		}
	}

	/** Beim Beenden alles Gepufferte schreiben */
	async flush() {
		const pending = [];
		for (const list of this.#lines.values()) {
			if (list.length > 0) {
				pending.push(bot.DB.ChatLine.insertMany(list.splice(0, list.length), { ordered: false }).catch(() => {}));
			}
		}
		await Promise.all([...pending, this.#storeMeta()]);
	}

	destroy() {
		for (const task of this.#tasks) {
			task.stop();
		}
	}
}

const chatLogger = new ChatLogger();

module.exports = { chatLogger };
