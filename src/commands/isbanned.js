const { getUserInfo } = require('../token/gql.js');

const REASONS = {
	TOS_INDEFINITE: 'ToS Indefinite',
	TOS_TEMPORARY: 'ToS Temporary',
	DMCA: 'DMCA Violation',
	DEACTIVATED: 'Account deactivated',
};

/** Ist ein Account von Twitch gesperrt? (aus sb-v2, oeffentliches GQL - ohne Zeitpunkt, den liefert GQL nicht) */
module.exports = {
	name: 'isbanned',
	aliases: ['isban'],
	cooldown: 3000,
	description: 'Checks whether an account is banned by Twitch.',
	usage: 'isbanned <user>',
	flags: ['mod'],
	execute: async (client, msg) => {
		const [target] = msg.args;
		const display = msg.displayName;
		const login = (target ?? '')
			.toLowerCase()
			.replace(/^[@#]+/, '')
			.trim();
		const user = await getUserInfo(login);
		if (!user) {
			return { text: `@${display}, user not found.` };
		} else if (!user.banned) {
			return { text: `@${display}, ${user.displayName} | IsBanned: False` };
		}

		const reason = REASONS[user.banReason ?? ''] ?? user.banReason ?? 'Unknown';
		return { text: `@${display}, ${user.displayName} | IsBanned: True - (${reason})` };
	},
};
