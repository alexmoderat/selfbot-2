/**
 * Auswertung der Zeilen aus chat_data.first_message_sightings (Network-Bot-Radar), aus sb-v2s v2/utils/sightings.ts:
 * pro Account und Channel die erste Nachricht ("fm::<Text>") oder ein Marker. Reine Funktionen.
 */

const time = (row) => Number(row.Seen_At.valueOf());

/** "fm::hi there" -> { kind: "fm", text: "hi there" }; ohne Praefix bleibt der ganze Text */
const splitKind = (normalized) => {
	const match = /^([a-z]{2})::([\s\S]*)$/.exec(normalized);
	return match ? { kind: match[1], text: match[2] } : { kind: '', text: normalized };
};

const summarize = (rows, topN = 5) => {
	if (rows.length === 0) {
		return null;
	}

	const sorted = [...rows].sort((a, b) => time(a) - time(b));
	const last = sorted[sorted.length - 1];
	const texts = new Map();
	for (const row of sorted) {
		const { kind, text } = splitKind(row.Normalized_Text);
		const label = kind && kind !== 'fm' ? `[${kind}] ${text}` : text;
		texts.set(label, (texts.get(label) ?? 0) + 1);
	}

	return {
		count: sorted.length,
		channels: new Set(sorted.map((i) => i.Channel_Name)).size,
		firstSeen: new Date(time(sorted[0])),
		lastSeen: new Date(time(last)),
		lastChannel: last.Channel_Name,
		topTexts: [...texts]
			.sort((a, b) => b[1] - a[1])
			.slice(0, topN)
			.map(([text, count]) => ({ text, count })),
	};
};

const iso = (date) => date.toISOString().replace('T', ' ').slice(0, 19);

/** Vollstaendige Liste fuers Haste */
const formatReport = (login, userId, rows, truncated) => {
	const summary = summarize(rows, 15);
	if (!summary) {
		return `${login} (${userId}): no sightings.`;
	}

	const sorted = [...rows].sort((a, b) => time(a) - time(b));
	return [
		`Sightings of ${login} (${userId}) — first_message_sightings`,
		`${summary.count}${truncated ? '+' : ''} sightings in ${summary.channels} channels, ${iso(summary.firstSeen)} to ${iso(summary.lastSeen)} UTC`,
		truncated ? '(list cut off at the row limit — there are more)' : '',
		'',
		'── Most common texts',
		...summary.topTexts.map((i) => `${String(i.count).padStart(5)}x  ${i.text}`),
		'',
		'── All sightings (UTC, oldest first)',
		...sorted.map((i) => `${iso(new Date(time(i)))}  #${i.Channel_Name.padEnd(24)} ${splitKind(i.Normalized_Text).text}`),
	]
		.filter((line, index) => line !== '' || index > 0)
		.join('\n');
};

module.exports = { splitKind, summarize, formatReport };
