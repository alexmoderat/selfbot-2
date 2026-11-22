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

const command = {
	name: 'monitor',
	aliases: ['addmonitor', 'addscammer'],
	cooldown: { user: 3 },
	access: { channel: 2 },
	description: 'Manually adds a user to the scammer/bot monitor.',
	usage: `monitor <user> --<${CATEGORY_FLAGS.join('|')}> [note]`,
	execute: async ({ client, message: msg }) => {
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
			return `@${display}, Usage: ${msg.prefix}${msg.invocation} <user> --<${CATEGORY_FLAGS.join('|')}> [note]`;
		}

		// Notiz nur anhaengen, wenn sie etwas Neues sagt - sonst kam "Scam: Scam" heraus
		const categoryLabel = CATEGORY_LABELS[category];
		const label = note && note.toLowerCase() !== categoryLabel.toLowerCase() ? `${categoryLabel}: ${note}` : categoryLabel;
		await bot.DB.createWithId('ModerationBanLog', {
			username: target,
			channelName: msg.channelData?.name ?? '',
			channel: msg.channelData?.id ?? null,
			type: 'ban',
			reason: `${label} (Reported by ${msg.sender.name})`,
			status: 'MANUAL',
			modName: msg.sender.name,
			automated: false,
			created: new Date(),
		});

		return `@${display}, ${target} added to the monitor: "${label}"`;
	},
};

module.exports = { command };
