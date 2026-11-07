const { got } = require('../token/got.js');
const { setTimeout: sleep } = require('node:timers/promises');
const { banUser, resolveTarget } = require('../services/moderation.js');
const { formatAutoBanReason } = require('../misc/ban-reason.js');

const BAN_DELAY = 650; // ~92 Bans/min, unter Twitchs 100/min
const LOOKUP_DELAY = 250;
const LOOKUP_CHUNK = 100; // Helix erlaubt 100 Logins je Anfrage

/** Paste-Links auf ihre Rohfassung umbiegen (aus sb-v2) */
const toRawUrl = (url) => {
	if (url.includes('haste.zneix.eu')) {
		return `https://haste.zneix.eu/raw/${url.split('/').pop() ?? ''}`;
	} else if (!url.includes('haste')) {
		return url;
	}

	let raw = url.replace('/share/', '/raw/').replace(/\/$/, '');
	if (!raw.includes('/raw/')) {
		const id = raw.split('/').pop() ?? '';
		if (id) {
			raw = raw.replace(id, `raw/${id}`);
		}
	}

	return raw;
};

/** Bannt alle User einer Paste-Liste, optional in mehreren Channels (aus sb-v2) */
module.exports = {
	name: 'massban',
	aliases: ['m'],
	cooldown: 3000,
	description: 'Bans every user from a paste list, optionally across several channels.',
	usage: 'massban <paste-url> [reason] [in:channel1,channel2]',
	flags: ['owner'],
	params: [{ name: 'in', type: 'string' }],
	execute: async (client, msg) => {
		const [url, ...reasonWords] = msg.args;
		const display = msg.displayName;
		if (!url || !/haste|pastebin|paste/.test(url)) {
			return { text: `@${display}, only paste links are accepted (haste/pastebin).` };
		}

		const targetChannels = msg.params.in
			? msg.params.in
					.split(',')
					.map((i) => i.trim().toLowerCase().replace('#', ''))
					.filter(Boolean)
			: [msg.channelData?.name].filter((i) => Boolean(i));

		const customReason = reasonWords.join(' ').trim();
		const reason = formatAutoBanReason(customReason || 'Mass ban', bot.Twitch.selfName);
		console.warn(`[massban] von ${msg.sender.name} | URL: ${url} | Grund: ${customReason || '—'} | Channels: ${targetChannels.join(', ')}`);

		// Liste laden
		const listResponse = await got('Global')({ url: toRawUrl(url), responseType: 'text' }).catch(() => null);
		if (!listResponse?.ok) {
			return { text: `@${display}, could not load list: ${listResponse?.statusCode ?? 'request failed'}` };
		}

		const usernames = String(listResponse.body)
			.split('\n')
			.map((i) => i.trim().toLowerCase())
			.filter((i) => i.length > 0 && !i.startsWith('#'));

		if (usernames.length === 0) {
			return { text: `@${display}, no users found in the list.` };
		}

		// User aufloesen (IDs brauchen keinen Lookup)
		let entries = [];
		if (usernames.every((i) => /^\d+$/.test(i))) {
			entries = usernames.map((id) => ({ id, login: id }));
		} else {
			for (let i = 0; i < usernames.length; i += LOOKUP_CHUNK) {
				const chunk = usernames.slice(i, i + LOOKUP_CHUNK);
				const response = await got('Helix')({
					url: 'users',
					searchParams: new URLSearchParams(chunk.map((login) => ['login', login])),
				});

				if (response.ok) {
					entries.push(...response.body.data.map((u) => ({ id: u.id, login: u.login })));
				} else {
					console.warn(`[massban] Lookup-Fehler ${response.statusCode}`);
				}

				await sleep(LOOKUP_DELAY);
			}
		}

		// Zielchannels aufloesen
		const channels = [];
		for (const name of targetChannels) {
			const probe = await resolveTarget(name, '0', '-');
			if (probe) {
				channels.push(name);
			} else {
				console.warn(`[massban] Channel ${name} nicht gefunden, uebersprungen`);
			}
		}

		if (channels.length === 0) {
			return { text: `@${display}, no valid channels found.` };
		}

		await msg.send(
			`@${display}, ${entries.length}/${usernames.length} users resolved — banning in ${channels.length} channel(s). This will take about ${Math.ceil((entries.length * channels.length * BAN_DELAY) / 60_000)} min.`,
		);

		let banned = 0;
		let failed = 0;
		for (const entry of entries) {
			for (const channelName of channels) {
				const target = await resolveTarget(channelName, entry.id, entry.login);
				const ok = target ? await banUser(target, { reason, status: 'MASSBAN' }) : false;
				if (ok) {
					banned++;
				} else {
					failed++;
				}

				await sleep(BAN_DELAY);
			}
		}

		return {
			text: `@${display}, massban done — ${banned} bans, ${failed} failed (${entries.length} users × ${channels.length} channel(s)).`,
		};
	},
};

Object.assign(module.exports, { toRawUrl });
