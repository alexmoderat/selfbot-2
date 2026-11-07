const { randomUUID } = require('node:crypto');
const { formatAutobanChange, lastAutobanChange, setAutobanSwitch } = require('../services/autoban-log.js');

/**
 * Schaltet die Autoban-Mechanismen pro Channel an oder aus (aus sb-v2). Ohne Unterbefehl gilt der Promo-Check.
 * "all" ist der Gesamtschalter: unterdrueckt jeden Ban/Timeout mit automatischem Grund (siehe banUser()).
 * promo/agecheck (join-check) und spam (low-trust) wirken, sobald die Module in Block 3 dazukommen.
 */
const FEATURES = {
	promo: { label: 'promo autoban', property: 'autobanPromoDisabled' },
	agecheck: { label: 'account age check', property: 'autobanAgecheckDisabled' },
	all: { label: 'all autobans', property: 'autobanDisabled' },
	spam: { label: 'spam autoban', property: 'autobanSpamDisabled' },
};

const ACTIONS = new Set(['enable', 'disable', 'status']);

module.exports = {
	name: 'autoban',
	cooldown: 3000,
	description: 'Toggle the per-channel autoban mechanisms: promo, agecheck, spam — or all of them at once (all).',
	usage: 'autoban <enable|disable|status> [channel:name] | autoban <agecheck|spam|all> <enable|disable|status> [channel:name]',
	flags: ['owner'],
	params: [{ name: 'channel', type: 'string' }],
	execute: async (client, msg) => {
		const [arg1, arg2, arg3] = msg.args;
		const display = msg.displayName;
		const usage = `${msg.prefix}${msg.invocation}`;
		const first = arg1?.toLowerCase();
		const isFeature = Boolean(first && first in FEATURES);
		const feature = isFeature ? first : 'promo';
		const action = (isFeature ? arg2 : arg1)?.toLowerCase();

		if (!action || !ACTIONS.has(action)) {
			return {
				text: `@${display}, Usage: ${usage} <enable|disable|status> [channel:name] | ${usage} <agecheck|spam|all> <enable|disable|status> [channel:name]`,
			};
		}

		// Channel als channel:name oder als nacktes Wort dahinter (beides gab es im alten Command)
		const bare = isFeature ? arg3 : arg2;
		const name = String(msg.params.channel ?? bare ?? msg.channelData?.name ?? '')
			.replace(/^#+/, '')
			.toLowerCase();
		const channel = bot.Channels.get(name);
		if (!channel) {
			return { text: `@${display}, I'm not in #${name}.` };
		}

		const spec = FEATURES[feature];
		if (action === 'status') {
			const off = (await bot.Channels.getData(channel, spec.property)) === true;
			const change = formatAutobanChange(await lastAutobanChange(channel, spec.property));
			return { text: `@${display}, ${spec.label} in #${channel.name}: ${off ? 'disabled' : 'enabled'} (${change}).` };
		}

		const disable = action === 'disable';
		await setAutobanSwitch(channel, spec.property, disable, msg.sender.name, 'command');
		return { text: `@${display}, ${spec.label} ${disable ? 'disabled' : 'enabled'} in #${channel.name}. (ID: ${randomUUID()})` };
	},
};
