// Eigener Ersatz fuer Twitchs first-msg-Tag, aus sb-v2s v2/singletons/chatter-registry.ts.
// EventSub channel.chat.message liefert das Flag nicht (GQL auch nicht) - der echte Wert kommt, wenn
// moeglich, aus dem CatQuery-Firehose (catquery-firehose.ts); diese Ableitung ist der Rueckfall.
//
// Kern: Collection channelChatter (channel, userId) - "diesen Account hat der Bot in diesem Channel
// schon einmal schreiben sehen". Der Upsert meldet atomar, ob das Dokument neu angelegt wurde.
// Ein Set je Channel faengt wiederkehrende Chatter ab, damit nicht jede Nachricht die DB beruehrt.
// Grenze: "neu" heisst nur "noch nie vom Bot gesehen" - fuer frisch gejointe Channels zu grosszuegig.

const MAX_CACHED_PER_CHANNEL = 200_000;
const seen = new Map();

/** Synchroner Schnellpfad: true = im Speicher schon als bekannt vermerkt */
const isKnown = (channelId, userId) => Boolean(seen.get(channelId)?.has(userId));

/**
 * true  = Account in diesem Channel bisher nie gesehen (und jetzt vermerkt).
 * false = schon bekannt - oder DB nicht erreichbar. Im Zweifel "nicht neu", nie ein Fehlalarm durch einen DB-Ausfall.
 */
const firstSeen = async (channelId, userId) => {
	if (!/^\d+$/.test(userId)) {
		return false;
	}

	let set = seen.get(channelId);
	if (!set) {
		set = new Set();
		seen.set(channelId, set);
	}
	if (set.has(userId)) {
		return false;
	}

	try {
		const result = await bot.DB.ChannelChatter.updateOne(
			{ channel: Number(channelId), userId },
			{ $setOnInsert: { firstSeen: new Date() } },
			{ upsert: true },
		);

		if (set.size >= MAX_CACHED_PER_CHANNEL) {
			set.clear(); // grob, aber begrenzt den Speicher
		}
		set.add(userId);

		return result.upsertedCount === 1;
	} catch (e) {
		console.warn(`[chatter-registry] ${channelId}/${userId}`, e);
		return false;
	}
};

module.exports = { isKnown, firstSeen };
