// Datumsformate wie in sb-v2 (v2/utils/streamer-streak.ts), damit Antworten gleich aussehen

const ordinal = (n) => {
	const v = n % 100;
	if (v >= 11 && v <= 13) {
		return `${n}th`;
	}

	switch (n % 10) {
		case 1:
			return `${n}st`;
		case 2:
			return `${n}nd`;
		case 3:
			return `${n}rd`;
		default:
			return `${n}th`;
	}
};

/** "2026-10-23" -> "october 23rd 2026" */
const fmtDate = (day) => {
	const d = new Date(`${day}T00:00:00Z`);
	const month = d.toLocaleDateString('en-US', { month: 'long', timeZone: 'UTC' }).toLowerCase();
	return `${month} ${ordinal(d.getUTCDate())} ${d.getUTCFullYear()}`;
};

/** ISO-Zeitpunkt -> "october 23rd 2026 14:05 UTC" */
const fmtDateTimeUtc = (iso) => {
	const d = new Date(iso);
	const hh = String(d.getUTCHours()).padStart(2, '0');
	const mm = String(d.getUTCMinutes()).padStart(2, '0');
	return `${fmtDate(d.toISOString().slice(0, 10))} ${hh}:${mm} UTC`;
};

module.exports = { ordinal, fmtDate, fmtDateTimeUtc };
