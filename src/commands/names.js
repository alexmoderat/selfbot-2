const { listOrLink } = require('../util/list-reply.js');
const { getKnownNames } = require('../token/catquery-api.js');

/** Fruehere Usernamen eines Accounts ueber CatQuery - nuetzlich gegen Ban-Evasion per Namensaenderung (aus sb-v2) */
module.exports = {
	name: 'names',
	aliases: ['pastnames', 'namehistory'],
	cooldown: 3000,
	description: 'Shows known past usernames of an account (via CatQuery).',
	usage: 'names <user>',
	flags: ['mod'],
	execute: async (client, msg) => {
		const [targetRaw] = msg.args;
		const display = msg.displayName;
		const target = targetRaw?.replace('@', '').toLowerCase();
		if (!target) {
			return { text: `@${display}, Usage: ${msg.prefix}${msg.invocation} <user>` };
		}

		const list = (await getKnownNames(target))
			.map((i) => i.name)
			.filter((i) => i.toLowerCase() !== target)
			.slice(0, 10);
		if (list.length === 0) {
			return { text: `@${display}, no known past usernames for ${target}.` };
		}

		return { text: `@${display}, known past usernames for ${target} (${list.length}): ${await listOrLink(list, `Past usernames of ${target}`)}` };
	},
};
