const phrases = require('../util/moderation-phrases.js');
const { uploadToHaste } = require('../token/haste.js');
const { validateBanphraseReason } = require('../util/ban-reason.js');

/** Grund-Pflicht nur fuer neue Phrasen - ein erneutes addbp auf eine vorhandene aendert nur die angegebenen Felder */
const reasonError = (list, phrase, name) => (list.some((i) => i.Phrase === phrase) ? null : validateBanphraseReason(name, phrase));

const MAX_TIMEOUT_SECONDS = 1_209_600; // 14 Tage, Twitchs Obergrenze

/** --flags aus den Argumenten ziehen, Rest zurueckgeben */
const extractFlags = (args) => {
	const flags = new Set();
	const rest = [];
	for (const arg of args) {
		if (/^--./.test(arg)) {
			flags.add(arg.slice(2).toLowerCase());
		} else {
			rest.push(arg);
		}
	}

	return { flags, rest };
};

/** trigger:/regex/flags oder trigger:wort -> { phrase, isRegex, regexFlags } */
const parseTrigger = (raw) => {
	if (!raw) {
		return null;
	}

	const match = raw.match(/^\/(.+)\/([a-z]*)$/);
	if (match) {
		return { phrase: match[1], isRegex: true, regexFlags: match[2] || 'i' };
	}

	return { phrase: raw, isRegex: false, regexFlags: 'i' };
};

/** length:-1 = permanent, sonst 1 s bis 14 Tage */
const parseLength = (length) => {
	if (length === undefined || Number.isNaN(length)) {
		return null;
	}

	return length === -1 ? null : Math.min(Math.max(length, 1), MAX_TIMEOUT_SECONDS);
};

/** Fuer addPhrase: nur angegebene Werte weiterreichen, damit ein erneutes Anlegen nichts zuruecksetzt */
const addOptions = (flags, p) => ({
	...(flags.has('ignorevip') ? { ignoreVip: true } : {}),
	...(flags.has('ignoresub') ? { ignoreSub: true } : {}),
	...(flags.has('escalate') ? { escalate: true } : {}),
	...(p.name !== undefined ? { name: p.name } : {}),
	...(p.length !== undefined ? { duration: parseLength(p.length) } : {}),
});

/** Genau eine Phrase per UUID(-Anfang), Name, Wortlaut oder Grund - sonst die Fehlerantwort */
const pickOne = (list, key) => {
	const hits = phrases.findByKey(list, key);
	if (hits.length > 1) {
		return { error: `"${key}" matches more than one banphrase — use the ID` };
	}

	return hits.length === 1 ? { phrase: hits[0] } : { error: null };
};

const editUsage = (channel) =>
	`${channel ? 'ceditbp <channel> <id|phrase>' : 'editbp <id|name|phrase>'} [trigger:<phrase|/regex/flags>] [name:"reason"] [length:seconds|-1] [ignorevip:true|false] [ignoresub:true|false] [escalate:true|false]`;

/**
 * Banphrases verwalten - global und je Channel (aus sb-v2). Ein Command mit Aliasen; name:, length:
 * und trigger: kommen ueber Params. Aenderungen greifen sofort (der Phrasen-Speicher laedt neu).
 */
const command = {
	name: 'banphrases',
	aliases: ['addbp', 'caddbp', 'delbp', 'cdelbp', 'removephrase', 'delphrase', 'editbp', 'ceditbp', 'phrases', 'listphrases', 'listbp'],
	cooldown: { user: 3 },
	access: { global: 1 },
	description: 'Create, delete and list ban phrases — global or per channel.',
	usage: 'addbp trigger:<phrase|/regex/flags> name:"reason" [--ignorevip] [--ignoresub] [--escalate] [length:seconds] | caddbp <channel> <phrase> name:"reason" [--regex] [--escalate] … | delbp <name|id> | cdelbp <channel> <phrase|id> | removephrase <phrase|id> | editbp <id|name|phrase> … | ceditbp <channel> <id|phrase> … | phrases',
	// Loeschen/Zuruecksetzen nur nach zweiter Bestaetigung (ninou2, 06.10.2026)
	flags: ['confirm'],
	params: [
		{ name: 'trigger', type: 'string' },
		{ name: 'name', type: 'string' },
		{ name: 'length', type: 'number' },
		{ name: 'ignorevip', type: 'boolean' },
		{ name: 'ignoresub', type: 'boolean' },
		{ name: 'escalate', type: 'boolean' },
	],
	execute: async ({ client, message: msg }) => {
		const rawArgs = [...msg.args];
		const display = msg.displayName;
		const mode = msg.invocation;
		const { flags, rest } = extractFlags(rawArgs);
		const p = msg.params;

		const resolveChannel = (name) => {
			const channelName = (name ?? '').replace(/^#+/, '').toLowerCase();
			return { channelName, channel: bot.Channels.get(channelName) };
		};

		// Auflisten (sb-v2: JSON im Format der Dashboard-Exporte)
		if (mode === 'banphrases' || mode === 'phrases' || mode === 'listphrases' || mode === 'listbp') {
			const list = phrases.getGlobal();
			if (list.length === 0) {
				return `@${display}, No phrases configured`;
			}

			const json = list.map((i) => {
				const escaped = i.Phrase.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
				const triggerBody = i.Is_Regex ? i.Phrase : `\\b${escaped}\\b`;
				return {
					id: i.UUID,
					name: i.Reason || i.Phrase,
					active: true,
					trigger: `/${triggerBody}/${i.Regex_Flags || 'i'}`,
					online: true,
					offline: true,
					length: i.Duration ?? -1,
					incremental: i.Escalate,
					multiplier: 1,
					silent: true,
					vipImmunity: i.Ignore_VIP,
					subImmunity: i.Ignore_Sub,
					createdAt: new Date(i.Created.valueOf()).toISOString(),
					channelId: '0',
				};
			});

			const url = await uploadToHaste(JSON.stringify(json, null, 2));
			return `@${display}, ${list.length} phrase(s): ${url}`;
		}

		// Global anlegen
		if (mode === 'addbp') {
			const trigger = parseTrigger(p.trigger);
			if (!trigger) {
				return `@${display}, Usage: addbp trigger:<phrase|/regex/flags> name:"reason" [--ignorevip] [--ignoresub] [--escalate] [length:-1]`;
			}

			const error = reasonError(phrases.getGlobal(), trigger.phrase, p.name);
			if (error) {
				return `@${display}, ${error} — add name:"reason".`;
			}

			const uuid = await phrases.addPhrase(
				{},
				{
					...trigger,
					...addOptions(flags, p),
					addedBy: msg.sender.name,
				},
			);

			return `@${display}, banphrase created successfully. (ID: ${uuid})`;
		}

		// Channel anlegen
		if (mode === 'caddbp') {
			const [channelRaw, ...phraseWords] = rest;
			const phrase = phraseWords.join(' ').trim();
			if (!channelRaw || !phrase) {
				return `@${display}, Usage: caddbp <channel> <phrase> name:"reason" [--regex] [--ignorevip] [--ignoresub] [length:-1]`;
			}

			const { channel, channelName } = resolveChannel(channelRaw);
			if (!channel) {
				return `@${display}, I'm not in #${channelName}.`;
			}

			const error = reasonError(phrases.getChannelPhrases(channel.id), phrase, p.name);
			if (error) {
				return `@${display}, ${error} — add name:"reason".`;
			}

			const uuid = await phrases.addPhrase(
				{ channel: channel.id },
				{
					phrase,
					isRegex: flags.has('regex'),
					regexFlags: 'i',
					...addOptions(flags, p),
					addedBy: msg.sender.name,
				},
			);

			return `@${display}, phrase added to #${channel.name}: "${phrase}" (ID: ${uuid})`;
		}

		// Aendern (global / Channel)
		if (mode === 'editbp' || mode === 'ceditbp') {
			const isChannel = mode === 'ceditbp';
			const channelRaw = isChannel ? rest.shift() : undefined;
			const key = rest.join(' ').trim();
			if (!key || (isChannel && !channelRaw)) {
				return `@${display}, Usage: ${editUsage(isChannel)}`;
			}

			const changes = {};
			const trigger = parseTrigger(p.trigger);
			if (trigger) {
				Object.assign(changes, { phrase: trigger.phrase, isRegex: trigger.isRegex, regexFlags: trigger.regexFlags });
			}
			if (p.name !== undefined) changes.name = p.name;
			if (p.length !== undefined) changes.duration = parseLength(p.length);
			if (p.ignorevip !== undefined) changes.ignoreVip = p.ignorevip;
			if (p.ignoresub !== undefined) changes.ignoreSub = p.ignoresub;
			if (p.escalate !== undefined) changes.escalate = p.escalate;

			const fields = phrases.changedFields(changes);
			if (fields.length === 0) {
				return `@${display}, nothing to change — give at least one of trigger:, name:, length:, ignorevip:, ignoresub:, escalate:.`;
			}

			let list = phrases.getGlobal();
			let where = '';
			if (isChannel) {
				const { channel, channelName } = resolveChannel(channelRaw);
				if (!channel) {
					return `@${display}, I'm not in #${channelName}.`;
				}

				list = phrases.getChannelPhrases(channel.id);
				where = ` in #${channel.name}`;
			}

			const result = await phrases.updatePhrase(list, key, changes);
			if (!result.ok) {
				const why = {
					notfound: `no banphrase found for "${key}"`,
					ambiguous: `"${key}" matches more than one banphrase — use the ID`,
					duplicate: 'a banphrase with that trigger already exists',
				}[result.reason];

				return `@${display}, ${why}${where}.`;
			}

			return `@${display}, banphrase updated${where}: ${fields.join(', ')}. (ID: ${result.uuid})`;
		}

		// Global loeschen (nach Name oder ID)
		if (mode === 'delbp') {
			const name = rest.join(' ').trim();
			if (!name) {
				return `@${display}, Usage: delbp <name|id>`;
			}

			const { phrase: found, error } = pickOne(phrases.getGlobal(), name);
			if (!found) {
				return `@${display}, ${error ?? `No banphrase found with name or ID "${name}"`}.`;
			}

			await phrases.removePhrase(found);
			return `@${display}, banphrase "${name}" deleted. (ID: ${found.UUID})`;
		}

		// Channel loeschen
		if (mode === 'cdelbp') {
			const [channelRaw, ...phraseWords] = rest;
			const phrase = phraseWords.join(' ').trim();
			if (!channelRaw || !phrase) {
				return `@${display}, Usage: cdelbp <channel> <phrase|id>`;
			}

			const { channel, channelName } = resolveChannel(channelRaw);
			if (!channel) {
				return `@${display}, Phrase not found in #${channelName}.`;
			}

			const { phrase: found, error } = pickOne(phrases.getChannelPhrases(channel.id), phrase);
			if (!found) {
				return `@${display}, ${error ?? 'Phrase not found'} in #${channel.name}.`;
			}

			await phrases.removePhrase(found);
			return `@${display}, phrase removed from #${channel.name}: "${found.Phrase}" (ID: ${found.UUID})`;
		}

		// Global loeschen (nach Wortlaut oder ID): removephrase / delphrase
		const phrase = rest.join(' ').trim();
		if (!phrase) {
			return `@${display}, Usage: removephrase <phrase|id>`;
		}

		const { phrase: found, error } = pickOne(phrases.getGlobal(), phrase);
		if (!found) {
			return `@${display}, ${error ? `${error}.` : 'Phrase not found!'}`;
		}

		await phrases.removePhrase(found);
		return `@${display}, Phrase removed! (ID: ${found.UUID})`;
	},
};

module.exports = { command };

Object.assign(module.exports, { parseTrigger, parseLength });
