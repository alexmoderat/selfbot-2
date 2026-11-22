const { got } = require('../token/got.js');
const { ivrUserDataSchema } = require('./schemas.js');

/**
 * Wo und wann ein User zuletzt im Chat war (aus dem Command stalk), als Daten fuer die Variablen {s_*} der Custom Commands.
 * s_kind: usage | nouser | self | bot | never | nochannel | banned | ok. Opt-out/Block gelten ueber die Flags des Custom Commands.
 */
const omittedBanReasons = new Set(['TOS_TEMPORARY', 'TOS_INDEFINITE']);

const getStalk = async ({ userRaw, msg, hasChannel }) => {
	const emote = async (names, fallback) => (msg?.getBestAvailableEmote ? msg.getBestAvailableEmote(names, fallback) : fallback);
	if (!userRaw) {
		return { kind: 'usage', emote: await emote(['forsen1'], '👀') };
	}

	const target = await bot.Users.get(userRaw);
	if (!target) {
		return { kind: 'nouser' };
	} else if (target.id === msg?.sender?.id && hasChannel) {
		return { kind: 'self', emote: await emote(['forsen1'], '👀') };
	} else if (target.name === bot.Twitch.selfName) {
		return { kind: 'bot', emote: await emote(['MrDestructoid'], '🤖') };
	}

	const last = await bot.DB.MessageMetaUserAlias.findOne({ userAlias: target.id }).sort({ lastMessagePosted: -1 }).lean();
	if (!last) {
		return { kind: 'never', first: bot.Utils.timeDelta(target.Started_Using) };
	}

	const channel = bot.Channels.get(last.channel);
	if (!channel) {
		return { kind: 'nochannel' };
	}

	if (target.twitchId && hasChannel) {
		const response = await got('IVR')({ url: 'v2/twitch/user', searchParams: { id: target.twitchId } });
		const info = ivrUserDataSchema.safeParse(response.body).data?.at(0);
		if (info?.banned && omittedBanReasons.has(info.banReason)) {
			return { kind: 'banned' };
		}
	}

	return {
		kind: 'ok',
		who: msg?.sender === target ? 'You were' : 'That user was',
		ago: bot.Utils.timeDelta(last.lastMessagePosted),
		channel: channel.getFullName(),
		text: last.lastMessageText,
	};
};

module.exports = { getStalk };
