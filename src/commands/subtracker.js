const sbv2 = require('../database/sbv2.js');

/**
 * Sub-Zaehler ueber praktisch ganz Twitch, aus sb-v2 (ninou2, 12.10.2026: "make the commands !subs"). Gezaehlt wird
 * im autojoin-bot ueber den CatQuery-Firehose in chat_data.global_sub_counter; hier nur lesen und den Anzeige-Schalter
 * "enabled" setzen (der Zaehler laeuft trotzdem weiter). Zaehlt nur vorwaerts - eine Annaeherung, kein echter Subcount.
 */

const formatSubtrackerTotal = (target, row) => {
	const sub = Number(row?.sub_count ?? 0);
	const resub = Number(row?.resub_count ?? 0);
	const gift = Number(row?.gift_count ?? 0);
	// ninou2, 13.10.2026: spricht den abgefragten Channel an, '"Estimated"' als Hinweis
	return `@${target} have a total of ${sub + resub + gift} subs (${sub} new, ${resub} resub, ${gift} gifted). "Estimated"`;
};

module.exports = {
	name: 'subtracker',
	aliases: ['subs'],
	cooldown: 3000,
	description:
		"Shows or toggles the sub counter (Twitch-wide, via the CatQuery firehose), for channels where Twitch's real subcount is unavailable (non-Affiliate/Partner). Takes an optional target channel to query from elsewhere.",
	usage: 'subtracker | subtracker on | subtracker off | subtracker <channel>',
	flags: ['mod', 'no-prefix'],
	execute: async (client, msg) => {
		const [arg] = msg.args;
		const display = msg.displayName;
		const own = msg.channelData?.name ?? '';

		if (arg === 'on' || arg === 'off') {
			if (!own) {
				return { text: null };
			}
			const value = arg === 'on' ? 1 : 0;
			// chat_data gehoert sb-v2/autojoin-bot (geteilte Daten in MariaDB)
			await sbv2.query('INSERT INTO chat_data.global_sub_counter (channel, enabled) VALUES (?, ?) ON DUPLICATE KEY UPDATE enabled = ?', [own, value, value]);
			return { text: `@${display}, sub counter turned ${arg.toUpperCase()}.` };
		}

		const target = (arg ?? own).replace(/^[@#]+/, '').toLowerCase();
		const rows = await sbv2.query('SELECT enabled, sub_count, resub_count, gift_count FROM chat_data.global_sub_counter WHERE channel = ?', [target]);
		const row = rows[0] ?? null;

		const who = target === own ? '' : `@${target}: `;
		if (row && !row.enabled) {
			return { text: `@${display}, ${who}sub counter is OFF.${target === own ? ` Turn it back on with "${msg.invocation} on".` : ''}` };
		}

		return { text: formatSubtrackerTotal(target, row) };
	},
};

Object.assign(module.exports, { formatSubtrackerTotal });
