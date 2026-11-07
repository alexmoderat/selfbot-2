const { Jimp } = require('jimp');

const HASH_SIZE = 8;

/**
 * Max. Hamming-Distanz (von 64), ab der zwei Thumbnails als "gleiches Video" gelten - geteilt zwischen
 * follow-protection (Sofort-Check) und dem fake-live-watch-Cron. Aus sb-v2s v2/utils/image-hash.ts.
 */
const FAKE_LIVE_MAX_DISTANCE = 6;

/**
 * Difference Hash (dHash): Bild auf 9x8 Graustufen verkleinern, benachbarte Pixel je Zeile vergleichen ->
 * 64-Bit-Hash als Hex-String. Robust gegen erneute JPEG-Kompression (Twitch liefert Thumbnails nie
 * byte-identisch), aber empfindlich genug, um unterschiedliche Frames desselben Spiels zu trennen.
 */
const dHashFromBuffer = async (buffer) => {
	const image = await Jimp.fromBuffer(buffer);
	image.resize({ w: HASH_SIZE + 1, h: HASH_SIZE });
	image.greyscale();

	let bits = '';
	for (let y = 0; y < HASH_SIZE; y++) {
		for (let x = 0; x < HASH_SIZE; x++) {
			const left = (image.getPixelColor(x, y) >>> 24) & 0xff;
			const right = (image.getPixelColor(x + 1, y) >>> 24) & 0xff;
			bits += left > right ? '1' : '0';
		}
	}

	return BigInt(`0b${bits}`)
		.toString(16)
		.padStart((HASH_SIZE * HASH_SIZE) / 4, '0');
};

/** Anzahl unterschiedlicher Bits zwischen zwei 64-Bit-Hex-dHashes (0 = identisch, 64 = maximal verschieden) */
const hammingDistance = (hashA, hashB) => {
	let xor = BigInt(`0x${hashA}`) ^ BigInt(`0x${hashB}`);
	let count = 0;
	while (xor > 0n) {
		count += Number(xor & 1n);
		xor >>= 1n;
	}

	return count;
};

module.exports = { FAKE_LIVE_MAX_DISTANCE, dHashFromBuffer, hammingDistance };
