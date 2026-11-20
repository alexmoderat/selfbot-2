const z = require('zod');

// Allgemeine Zod-Formen aus Supibots utils/schemas.ts
const probabilityShape = z.number().min(0).max(1);
const percentShape = z.number().min(0).max(100);
const degreeShape = z.number().min(0).max(360);
const unixTimestampShape = z.number().int().nonnegative();

// Twitch-/IVR-Formen aus Supibots utils/schemas.ts (Block 7: accountage, getprofilepicture, topstreams)
const twitchStreamSchema = z.object({
	data: z.array(
		z.object({
			id: z.string(),
			user_id: z.string(),
			user_login: z.string(),
			user_name: z.string(),
			game_id: z.string(),
			game_name: z.string(),
			type: z.enum(['live', '']),
			title: z.string(),
			tags: z.array(z.string()).nullable(),
			viewer_count: z.int().min(0),
			started_at: z.iso.datetime(),
			language: z.string(),
			thumbnail_url: z.string(),
			/**
			 * Despite what Twitch's Helix API documentation says, this field can be `true`.
			 * Disregard this (Helix API docs): `IMPORTANT This field is deprecated and returns only false.`
			 */
			is_mature: z.boolean(),
		}),
	),
});

const BaseIvrUserDataSchema = z.object({
	login: z.string(),
	displayName: z.string(),
	id: z.string(),
	bio: z.string().nullable(),
	follows: z.null(),
	followers: z.number(),
	profileViewCount: z.null(),
	chatColor: z.string().nullable(),
	logo: z.string(),
	banner: z.string().nullable(),
	verifiedBot: z.null(),
	createdAt: z.string(),
	updatedAt: z.string(),
	emotePrefix: z.string().nullable(),
	roles: z.object({
		isAffiliate: z.boolean(),
		isPartner: z.boolean(),
		isStaff: z.boolean().nullable(),
	}),
	badges: z.array(
		z.object({
			setID: z.string(),
			title: z.string(),
			description: z.string(),
			version: z.string(),
		}),
	),
	chatterCount: z.number().nullable(),
	chatSettings: z
		.object({
			chatDelayMs: z.number(),
			followersOnlyDurationMinutes: z.number().nullable(),
			slowModeDurationSeconds: z.number().nullable(),
			blockLinks: z.boolean(),
			isSubscribersOnlyModeEnabled: z.boolean(),
			isEmoteOnlyModeEnabled: z.boolean(),
			isFastSubsModeEnabled: z.boolean(),
			isUniqueChatModeEnabled: z.boolean(),
			requireVerifiedAccount: z.boolean(),
			rules: z.array(z.string()),
		})
		.nullable(),
	stream: z
		.object({
			title: z.string(),
			id: z.string(),
			createdAt: z.string(),
			type: z.union([z.literal('live'), z.literal('rerun')]),
			viewersCount: z.number(),
			game: z.object({ displayName: z.string() }).nullable(),
		})
		.nullable(),
	lastBroadcast: z
		.object({
			startedAt: z.string().nullable(),
			title: z.string().nullable(),
		})
		.nullable(),
	panels: z.array(z.object({ id: z.string() })),
});

const RegularIvrUserDataSchema = BaseIvrUserDataSchema.extend({
	banned: z.literal(false),
});

const BannedIvrUserDataSchema = BaseIvrUserDataSchema.extend({
	followers: z.number().nullish(),
	emotePrefix: z.string().nullish(),
	banned: z.literal(true),
	banReason: z.union([z.literal('TOS_INDEFINITE'), z.literal('TOS_TEMPORARY'), z.literal('DMCA'), z.literal('DEACTIVATED')]),
});

const ivrUserDataSchema = z.array(z.union([RegularIvrUserDataSchema, BannedIvrUserDataSchema]));

// Supibots twitchChannelSchema (Block 8: shoutout)
const twitchChannelSchema = z.object({
	data: z.array(
		z.object({
			broadcaster_id: z.string(),
			broadcaster_language: z.string(),
			broadcaster_login: z.string(),
			broadcaster_name: z.string(),
			content_classification_labels: z.array(z.unknown()),
			delay: z.int(),
			game_id: z.string(),
			game_name: z.string(),
			is_branded_content: z.boolean(),
			tags: z.array(z.string()),
			title: z.string(),
		}),
	),
});

module.exports = { probabilityShape, percentShape, degreeShape, unixTimestampShape, twitchStreamSchema, ivrUserDataSchema, twitchChannelSchema };
