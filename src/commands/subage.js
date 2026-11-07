const { fetchTwitchUser } = require('../util/twitch/twitch-utils.js');
const { gqlSmartbox } = require('../misc/twitch-gql.js');

/**
 * Sub-Alter und -Typ eines Users in einem Channel, aus sb-v2 (Block 7: sb-v2-Version). Rohe GQL-Query ueber die
 * SmartBox-Client-Id - der Client-Integrity-Check greift nur bei der Web-Client-Id (w77hxhx, 01.10.2026).
 */
const formatSubDuration = (ms) => {
	const days = Math.floor(ms / 86_400_000);
	const months = Math.floor(days / 30);
	const years = Math.floor(months / 12);

	const parts = [];
	if (years > 0) parts.push(`${years}y`);
	if (months % 12 > 0) parts.push(`${months % 12}mo`);
	if (days % 30 > 0 && parts.length < 2) parts.push(`${days % 30}d`);
	return parts.join(' ') || '0d';
};

const TIER_NAMES = { 1000: 'Tier 1', 2000: 'Tier 2', 3000: 'Tier 3' };

/** "(Tier 1)", "(Tier 2, Prime)", "(Tier 1, gifted by @x)" - nur fuer aktive Subs aussagekraeftig (ninou2, 17.10.2026) */
const formatSubType = (benefit) => {
	if (!benefit?.tier) {
		return '';
	}

	const tier = TIER_NAMES[benefit.tier] ?? `Tier ${benefit.tier}`;
	if (benefit.gift?.isGift) {
		const gifter = benefit.gift.gifter?.displayName ?? benefit.gift.gifter?.login;
		return ` (${tier}, gifted${gifter ? ` by @${gifter}` : ''})`;
	}
	if (benefit.purchasedWithPrime) {
		return ` (${tier}, Prime)`;
	}
	return ` (${tier})`;
};

// ninou2, 17.10.2026: "pluriel get s at the end"
const pluralMonths = (n) => `${n} month${n === 1 ? '' : 's'}`;

const buildSubageResponse = (displayUser, displayChannel, relationship, now = Date.now()) => {
	const cumulative = relationship?.cumulative;
	const streak = relationship?.streak;

	// "nie gesubbt" und "Status versteckt" sehen bei GQL gleich aus - neutral formulieren statt "hidden" zu behaupten
	if (!cumulative || cumulative.months === 0) {
		return `${displayUser} is not subscribed to ${displayChannel}, and never has been.`;
	}

	const endDate = cumulative.end ? new Date(cumulative.end) : null;
	const streakSuffix = streak && streak.months > 0 ? `, currently on a ${streak.months} month streak` : '';
	if (endDate && endDate.getTime() > now) {
		return (
			`${displayUser} has a subscription to ${displayChannel}${formatSubType(relationship?.subscriptionBenefit)} ` +
			`for a total of ${pluralMonths(cumulative.months)}, expires in ${formatSubDuration(endDate.getTime() - now)}${streakSuffix}.`
		);
	}

	const endedAgo = endDate ? ` (ended ${formatSubDuration(now - endDate.getTime())} ago)` : '';
	return (
		`${displayUser} is not currently subscribed to ${displayChannel} ` + `but previously was for a total of ${pluralMonths(cumulative.months)}${endedAgo}.`
	);
};

module.exports = {
	name: 'subage',
	aliases: ['sa', 'sub'],
	cooldown: 3000,
	description: 'Sub age and type (Tier/Prime/gifted) of a user in a channel.',
	usage: 'subage [user] [channel]',
	flags: ['mod'],
	execute: async (client, msg) => {
		const [userArg, channelArg] = msg.args;
		const display = msg.displayName;
		const user = (userArg ?? msg.sender.name).toLowerCase().replace(/^[@#]+/, '');
		const channel = (channelArg ?? msg.channelData?.name ?? '').toLowerCase().replace(/^[@#]+/, '');

		const channelData = channel ? await fetchTwitchUser(channel).catch(() => null) : null;
		if (!channelData) {
			return { text: `@${display}, no Twitch account named "${channel}" exists.` };
		}

		const query = `
			query {
				info: user(login: ${JSON.stringify(user)} lookupType: ALL) {
					id
					displayName
					relationship(targetUserID: ${JSON.stringify(channelData.id)}) {
						followedAt
						cumulative: subscriptionTenure(tenureMethod: CUMULATIVE) { months end }
						streak: subscriptionTenure(tenureMethod: STREAK) { months }
						subscriptionBenefit { tier purchasedWithPrime gift { isGift gifter { login displayName } } }
					}
				}
			}
		`;

		const data = await gqlSmartbox(query);
		if (!data?.info) {
			return { text: `@${display}, User ${user} does not exist on Twitch, or is banned!` };
		}

		// ninou2, 17.10.2026: "can you make it @ the users"
		return { text: `@${display}, ${buildSubageResponse(`@${data.info.displayName || user}`, `@${channel}`, data.info.relationship)}` };
	},
};

Object.assign(module.exports, { formatSubDuration, formatSubType, buildSubageResponse });
