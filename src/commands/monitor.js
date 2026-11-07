/**
 * Manuelles Eintragen in die eigene Scammer-Ueberwachung (Ban-Log, Status MANUAL), aus sb-v2. Die Kategorie kommt
 * als --flag statt als freier Text, damit sie garantiert zum Scammer-Muster der Auswertung passt (Block 9: /api/scammer).
 * Reine Erfassung, kein Ban/Timeout.
 */
const CATEGORY_LABELS = {
	viewbot: 'Viewbot Services',
	sellerbot: 'SellerBot',
	followbot: 'Follow-Bot',
	malware: 'Malware',
	scam: 'Scam',
	phishing: 'Phishing',
	banevader: 'Ban Evader',
};
const CATEGORY_FLAGS = Object.keys(CATEGORY_LABELS);

module.exports = {
	name: 'monitor',
	aliases: ['addmonitor', 'addscammer'],
	cooldown: 3000,
	description: 'Manually adds a user to the scammer/bot monitor.',
	usage: `monitor <user> --<${CATEGORY_FLAGS.join('|')}> [note]`,
	flags: ['mod'],
	execute: async (client, msg) => {
		const [targetRaw, ...rest] = msg.args;
		const display = msg.displayName;
		const target = (targetRaw ?? '').toLowerCase().replace(/^@/, '').trim();
		const flags = new Set(rest.filter((i) => /^--./.test(i)).map((i) => i.slice(2).toLowerCase()));
		const note = rest
			.filter((i) => !/^--./.test(i))
			.join(' ')
			.trim();
		const category = CATEGORY_FLAGS.find((i) => flags.has(i));
		if (!target || !category) {
			return { text: `@${display}, Usage: ${msg.prefix}${msg.invocation} <user> --<${CATEGORY_FLAGS.join('|')}> [note]` };
		}

		// Notiz nur anhaengen, wenn sie etwas Neues sagt - sonst kam "Scam: Scam" heraus
		const categoryLabel = CATEGORY_LABELS[category];
		const label = note && note.toLowerCase() !== categoryLabel.toLowerCase() ? `${categoryLabel}: ${note}` : categoryLabel;
		const row = await core.Query.getRow('selfbot_data', 'Moderation_Ban_Log'); // TODO(port)
		row.setValues({
			Username: target,
			Channel_Name: msg.channelData?.name ?? '',
			Channel: msg.channelData?.id ?? null,
			Type: 'ban',
			Reason: `${label} (Reported by ${msg.sender.name})`,
			Status: 'MANUAL',
			Mod_Name: msg.sender.name,
			Automated: false,
		});
		await row.save({ skipLoad: true });

		return { text: `@${display}, ${target} added to the monitor: "${label}"` };
	},
};
