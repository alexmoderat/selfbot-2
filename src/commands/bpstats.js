const phrases = require('../services/moderation-phrases.js');
const { buildReport } = require('../misc/banphrase-stats.js');
const { uploadToHaste } = require('../misc/haste.js');

/** Auswertung der globalen Banphrases als Haste-Link: Treffer, ungenutzte, Alter (aus sb-v2) */
module.exports = {
	name: 'bpstats',
	aliases: ['banphrasestats'],
	cooldown: 3000,
	description:
		'Stats for the global ban phrases as a hastebin link: top hits, phrases without hits, age. days:N only lists unused phrases at least N days old.',
	usage: 'bpstats [days:90]',
	flags: ['owner'],
	params: [{ name: 'days', type: 'number' }],
	execute: async (client, msg) => {
		const display = msg.displayName;
		const days = msg.params.days ?? 0;
		if (!Number.isFinite(days) || days < 0) {
			return { text: `@${display}, days must be a number ≥ 0.` };
		}

		const list = phrases.getGlobal();
		if (list.length === 0) {
			return { text: `@${display}, no global ban phrases configured.` };
		}

		const triggers = await phrases.getHitStats();
		const statPhrases = list.map((i) => ({
			phrase: i.Phrase,
			name: i.Name,
			is_regex: i.Is_Regex,
			created_at: new Date(i.Created.valueOf()),
			uuid: i.UUID,
		}));

		const { text, summary } = buildReport(statPhrases, triggers, Date.now(), days);
		const url = await uploadToHaste(text);
		return {
			text: `@${display}, ${summary.total} phrases · ${summary.triggers} matches · ${summary.withHits} with hits · ${summary.unused} without${days ? ` (${summary.shown} older than ${days}d)` : ''} · +${summary.otherTriggers} from presets/channels: ${url}`,
		};
	},
};
