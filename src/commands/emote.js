const { fetchTwitchUser } = require('../util/twitch/twitch-utils.js');
const { formatEmoteTierLabel, resolveEmoteChannel, searchEmoteByName } = require('../misc/emote-lookup.js');
const { fetchChannelEmotes } = require('../misc/twitch-info.js');

/**
 * Details zu einem Twitch-Emote, plattformweit per Name gesucht (Vorbild PotatBotats "#emote", ninou2 + alexmoderat,
 * 29.09.2026), aus sb-v2: Suche ueber CommanderRoots Tool, die Details danach ueber Helix
 */
module.exports = {
	name: 'emote',
	cooldown: 3000,
	description: 'Look up a Twitch emote by name — owner, tier, type, and image link.',
	usage: 'emote <name>',
	execute: async (client, msg) => {
		const [nameRaw] = msg.args;
		const display = msg.displayName;
		const name = nameRaw?.trim();
		if (!name) {
			return { text: `@${display}, Usage: ${msg.invocation} <name>` };
		}

		const hit = await searchEmoteByName(name);
		if (!hit) {
			return { text: `@${display}, no emote named "${name}" found.` };
		}

		const channel = await resolveEmoteChannel(hit.id);
		if (!channel) {
			return { text: `@${display}, found "${hit.token}" but couldn't resolve its owning channel.` };
		}

		const owner = await fetchTwitchUser(channel).catch(() => null);
		if (!owner) {
			return { text: `@${display}, owning channel "${channel}" not found on Twitch.` };
		}

		const emotes = await fetchChannelEmotes(owner.id);
		const match = emotes.find((i) => i.id === hit.id) ?? emotes.find((i) => i.name.toLowerCase() === hit.token.toLowerCase());
		if (!match) {
			return { text: `@${display}, ${hit.token} belongs to #${channel}, but Twitch's own API no longer lists it (renamed or removed?).` };
		}

		const tierLabel = formatEmoteTierLabel(match.emote_type, match.tier);
		return {
			text:
				`@${display}, ${match.name} — owned by #${channel} • ${tierLabel} • ${match.format.join('/')} ` +
				`• Set ID: ${match.emote_set_id} • ${match.images.url_4x}`,
		};
	},
};
