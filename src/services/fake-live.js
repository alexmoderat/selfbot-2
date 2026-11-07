// Daten der Fake-Live-Erkennung, aus sb-v2s stream-hash-log-maria.ts und fake-live-watch-maria.ts.
// streamHashLog: juengst gesehene Live-Thumbnails (dHash als Dezimal-Text, 64 Bit - der Abstand wird mit BigInt
// gerechnet), 7 Tage. Fake_Live_Watch: Warteliste fuer den Cron, ein aufgezeichneter Loop kann beim ersten Blick
// phasenverschoben zu einem anderen Bot-Account stehen (echter Test 30.09.2026: Distanz 22/64 statt Treffer).

const RETENTION_DAYS = 7;
const WATCH_WINDOW = 60 * 60 * 1000;

const toDecimal = (hashHex) => {
	if (!/^[0-9a-f]{1,16}$/i.test(hashHex)) {
		throw new Error('invalid hash');
	}
	return BigInt(`0x${hashHex}`).toString();
};

/** Gesetzte Bits einer BigInt-Zahl */
const popcount = (value) => {
	let count = 0;
	for (let rest = value; rest > 0n; rest >>= 1n) {
		count += Number(rest & 1n);
	}
	return count;
};

/** hashHex: 16-stelliger dHash-Hex-String (utils/image-hash.ts) */
const recordHash = async (channel, userId, hashHex) => {
	await bot.DB.createWithId('StreamHashLog', { channelName: channel.toLowerCase(), userId, hash: toDecimal(hashHex), seenAt: new Date() });
	await bot.DB.StreamHashLog.deleteMany({ seenAt: { $lt: new Date(Date.now() - RETENTION_DAYS * 86_400_000) } });
};

/** Naechster Treffer aus einem ANDEREN Channel innerhalb maxDistance (kleinster Abstand zuerst), sonst null */
const findHashMatch = async (channel, hashHex, maxDistance) => {
	// Wenige Eintraege (7 Tage): Abstand in JS wie BIT_COUNT(a ^ b)
	const target = BigInt(toDecimal(hashHex));
	const rows = await bot.DB.StreamHashLog.find({ channelName: { $ne: channel.toLowerCase() } }, { channelName: 1, userId: 1, hash: 1 }).lean();
	let best = null;
	for (const row of rows) {
		const distance = popcount(BigInt(row.hash) ^ target);
		if (distance <= Number(maxDistance) && (!best || distance < best.distance)) {
			best = { channel: row.channelName, userId: String(row.userId), distance };
		}
	}
	return best;
};

/** Neu eintragen oder Ablaufzeit erneuern (erneuter Follow-Versuch) */
const enqueueWatch = async (channel, userId) => {
	const expires = new Date(Date.now() + WATCH_WINDOW);
	await bot.DB.FakeLiveWatch.updateOne({ channelName: channel.toLowerCase(), userId }, { $set: { expires } }, { upsert: true });
};

const removeWatch = async (channel, userId) => {
	await bot.DB.FakeLiveWatch.deleteOne({ channelName: channel.toLowerCase(), userId });
};

/** [{ Channel_Name, User_ID }] */
const listPendingWatches = async () =>
	(await bot.DB.FakeLiveWatch.find({ expires: { $gte: new Date() } }).lean()).map((i) => ({ Channel_Name: i.channelName, User_ID: i.userId }));

const removeExpiredWatches = async () => {
	await bot.DB.FakeLiveWatch.deleteMany({ expires: { $lt: new Date() } });
};

module.exports = { recordHash, findHashMatch, enqueueWatch, removeWatch, listPendingWatches, removeExpiredWatches };
