const { streamData } = require('../util/stream-tracking.js');
const { formatCategoryParts } = require('../util/category-hours.js');
const { MONTHS, isPeriodWord } = require('../util/stream-hours.js');
const { fmtDate } = require('../util/streamer-streak.js');
const { replyInChunks } = require('../util/tracking-format.js');

/**
 * Kategorie-Stunden fuer jedes Jahr mit Daten (neueste zuerst), aus sb-v2 (ninou2, 13.10.2026). Auf Kategorie-Ebene
 * gepackt: ein Jahr darf ueber mehrere Nachrichten gehen, jede Fortsetzung beginnt wieder mit der Jahreszahl
 * (alexmoderat, 15.10.2026: "Warum antwortet der bot bei ninou nicht" - eine Zeile war 836 Zeichen lang).
 */
const MESSAGE_LIMIT = 480;

const command = {
	name: 'hoursstreamedcategorieshistory',
	aliases: ['hsch'],
	cooldown: { user: 3 },
	access: { channel: 0 },
	description: 'Hours streamed per category for a channel, broken down by year (full tracked history, newest year first). Defaults to the current channel.',
	usage: 'hoursstreamedcategorieshistory [channel]',
	execute: async ({ client, message: msg }) => {
		// Mit Zeitraum ("!hsch im_row1 november2026") ist die Verlaufsansicht falsch, das kann !hsc
		if (msg.args.some(isPeriodWord)) {
			return await require('./hoursstreamedcategories.js').execute(client, msg);
		}

		const [channelRaw] = msg.args;
		const display = msg.displayName;
		const channel = (channelRaw ?? msg.channelData?.name ?? '').replace(/^[@#]+/, '').toLowerCase();
		const own = channel === msg.channelData?.name;
		const where = own ? 'this channel' : `#${channel}`;
		const userId = await streamData.fetchUserId(channel);
		if (!userId) {
			return `@${display}, no Twitch account named "${channel}" exists.`;
		}

		const years = await streamData.getCategoryYears(userId);
		if (years.length === 0) {
			return `@${display}, no tracked hours for ${where} yet — either tracking just started, or that's not a channel I watch.`;
		}

		const segments = [];
		for (const year of years) {
			const rows = await streamData.getCategoryYearBreakdown(userId, year);
			const parts = formatCategoryParts(rows.map((i) => ({ category: i.category, minutes: Math.round(i.seconds / 60) })));
			if (parts.length > 0) {
				segments.push({ year, parts });
			}
		}

		if (segments.length === 0) {
			return `@${display}, no tracked hours for ${where} yet.`;
		}

		// Das aelteste (letzte) Jahr bekommt den Tracking-Start
		const oldestYear = years[years.length - 1];
		const firstSeen = await streamData.getCategoryFirstSeen(userId);
		let note = '';
		if (firstSeen && Number(firstSeen.slice(0, 4)) === oldestYear) {
			note = ` (tracking started on ${fmtDate(firstSeen)})`;
		} else {
			const earliest = await streamData.getCategoryEarliestPeriod(userId);
			if (earliest) {
				const [eYear, eMonth] = earliest.split('-').map(Number);
				if (eMonth > 1) {
					note = ` (tracking started in ${MONTHS[eMonth - 1]} ${eYear})`;
				}
			}
		}

		const head = `@${display}, ${channel} by year: `;
		const chunks = [];
		let current = head;
		for (const { year, parts } of segments) {
			for (let i = 0; i < parts.length; i++) {
				const piece = i === 0 ? `${current === head ? '' : ' // '}${year}: ${parts[i]}` : ` ${parts[i]}`;
				if (current.length + piece.length > MESSAGE_LIMIT) {
					chunks.push(current);
					current = `${year}: ${parts[i]}`;
				} else {
					current += piece;
				}
			}
		}
		chunks.push(current);

		if (note) {
			const last = chunks.length - 1;
			if (chunks[last].length + note.length <= MESSAGE_LIMIT) {
				chunks[last] += note;
			} else {
				chunks.push(note.trim());
			}
		}

		return await replyInChunks(msg, chunks);
	},
};

module.exports = { command };
