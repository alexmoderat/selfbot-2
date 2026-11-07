const { got } = require('../token/got.js');
const { uploadList } = require('../misc/haste.js');

/** Alle Channels, in denen der User VIP ist (paginiert ueber ttv.tools), aus sb-v2 */
const fetchVipChannels = async (login) => {
	const channels = [];
	let cursor = '';
	do {
		const response = await got('GenericAPI')({
			url: `https://ttv.tools/api/roles/vip/${encodeURIComponent(login)}`,
			searchParams: { perPage: 100, ...(cursor ? { after: cursor } : {}) },
			timeout: { request: 15_000 },
		});
		channels.push(...(response.body.data ?? []).map((i) => i.login));
		cursor = response.body.page + 1 < response.body.pages ? (response.body.cursor ?? '') : '';
	} while (cursor);

	return channels;
};

module.exports = {
	name: 'vipcount',
	aliases: ['vl'],
	cooldown: 3000,
	description: 'In how many channels a user is VIP (source: ttv.tools).',
	usage: 'vipcount [user]',
	flags: ['mod'],
	execute: async (client, msg) => {
		const [userArg] = msg.args;
		const display = msg.displayName;
		const target = (userArg ?? msg.sender.name).toLowerCase().replace('@', '');
		const channels = await fetchVipChannels(target);
		if (channels.length === 0) {
			return { text: `@${display}, ${target} is not a VIP in any channel (per ttv.tools).` };
		}

		const url = await uploadList(`VIP Channels for ${target}`, channels);
		return { text: `@${display}, ${target} is a VIP in ${channels.length} channels: ${url}` };
	},
};
