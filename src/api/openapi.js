// OpenAPI-Spec der oeffentlichen Endpunkte fuer /docs, aus sb-v2s src/services/openapi-spec.ts
const { baseUrl } = require('../misc/user-tokens.js');

/**
 * OpenAPI-Spec nur für die öffentlichen (auth-freien) JSON-Endpoints —
 * die vielen /api/admin/*- und /api/*-Routen mit requireSession/requireAdmin
 * sind Dashboard-intern und bewusst nicht Teil der Doku, um kein Session-
 * Cookie-Verhalten dokumentieren zu müssen, das Swagger UI ohnehin nicht
 * nachbilden kann.
 */
const createOpenApiSpec = () => ({
	openapi: '3.0.0',
	info: {
		title: 'AlexBot API',
		version: '1.0.0',
		description:
			'Public endpoints of the bot, plus token-protected /v1 endpoints (use "Authorize" with an API key from WEB_API_KEYS as Bearer; keys go in the Authorization header only).',
	},
	components: {
		securitySchemes: { bearerAuth: { type: 'http', scheme: 'bearer' } },
	},
	servers: [{ url: baseUrl() }],
	paths: {
		'/api/scammer': {
			get: {
				summary: 'Check whether an account is flagged as a scammer/bot in our own bans',
				description:
					'Based on ban_log: bans (by any mod/bot) with a clearly categorized reason (Viewbot, SellerBot, Follow-Bot, Malware, Scam, Phishing, Ban-Evader).',
				tags: ['Moderation'],
				parameters: [
					{
						name: 'name',
						in: 'query',
						required: true,
						schema: { type: 'string' },
						description: 'Twitch login (case-insensitive)',
					},
				],
				responses: {
					200: {
						description: 'Scammer status',
						content: {
							'application/json': {
								schema: {
									type: 'object',
									properties: {
										monitored: { type: 'boolean' },
										reason: { type: 'string', nullable: true },
										banCount: { type: 'integer' },
										channels: { type: 'array', items: { type: 'string' } },
									},
								},
							},
						},
					},
					400: { description: 'name parameter is missing' },
				},
			},
		},
		'/api/monitored': {
			get: {
				summary: 'Check whether an account is monitored (bans, plus suspected repeated first messages)',
				description:
					'Like /api/scammer, but also reports accounts whose first message shows up in 2+ channels without a ban yet. Uncached lookups read a large table (~40 s) and are rate limited: answers 503 with Retry-After when busy.',
				tags: ['Moderation'],
				parameters: [{ name: 'name', in: 'query', required: true, schema: { type: 'string' }, description: 'Twitch login (case-insensitive)' }],
				responses: {
					200: {
						description: 'Monitored status',
						content: {
							'application/json': {
								schema: {
									type: 'object',
									properties: {
										monitored: { type: 'boolean' },
										reason: { type: 'string', nullable: true },
										banCount: { type: 'integer' },
										channels: { type: 'array', items: { type: 'string' } },
									},
								},
							},
						},
					},
					400: { description: 'name parameter is missing' },
					202: { description: 'Lookup still running (after ~40 s) — ask again in about 30 s, the result is cached once it finishes' },
					503: { description: 'Lookup busy, retry after the given time' },
				},
			},
		},
		'/v1/sightings': {
			get: {
				summary: 'First-message sightings of an account (network bot radar)',
				description:
					'Channels and texts where the account wrote its first message, oldest first (max 2000). The first lookup takes about 40 s, results are cached for 10 minutes; one lookup at a time (503 when busy).',
				tags: ['Radar'],
				security: [{ bearerAuth: [] }],
				parameters: [{ name: 'name', in: 'query', required: true, schema: { type: 'string' }, description: 'Twitch login' }],
				responses: {
					200: {
						description: 'Sightings',
						content: {
							'application/json': {
								schema: {
									type: 'object',
									properties: {
										login: { type: 'string' },
										userId: { type: 'string' },
										cached: { type: 'boolean' },
										truncated: { type: 'boolean' },
										count: { type: 'integer' },
										channels: { type: 'integer' },
										firstSeen: { type: 'string', format: 'date-time', nullable: true },
										lastSeen: { type: 'string', format: 'date-time', nullable: true },
										topTexts: {
											type: 'array',
											items: { type: 'object', properties: { text: { type: 'string' }, count: { type: 'integer' } } },
										},
										sightings: {
											type: 'array',
											items: {
												type: 'object',
												properties: {
													channel: { type: 'string' },
													seenAt: { type: 'string', format: 'date-time' },
													kind: { type: 'string' },
													text: { type: 'string' },
												},
											},
										},
									},
								},
							},
						},
					},
					400: { description: 'name is missing' },
					401: { description: 'Unauthorized' },
					202: { description: 'Lookup still running (after ~40 s) — ask again in about 30 s, the result is cached once it finishes' },
					404: { description: 'User not found' },
					503: { description: 'Lookup busy, retry after the given time' },
				},
			},
		},
		'/v1/live-chatters': {
			get: {
				summary: 'Live streamers among the recent chatters of a channel',
				description:
					'Only channels the bot logs. Each candidate carries the CatQuery monitoring status (null if not looked up: only the 40 most active live chatters are checked).',
				tags: ['Radar'],
				security: [{ bearerAuth: [] }],
				parameters: [
					{ name: 'channel', in: 'query', required: true, schema: { type: 'string' }, description: 'Channel login' },
					{ name: 'minutes', in: 'query', required: false, schema: { type: 'integer', default: 60, minimum: 1, maximum: 1440 } },
					{
						name: 'onlyUnmonitored',
						in: 'query',
						required: false,
						schema: { type: 'boolean' },
						description: 'Hide accounts CatQuery already monitors',
					},
				],
				responses: {
					200: {
						description: 'Candidates',
						content: {
							'application/json': {
								schema: {
									type: 'object',
									properties: {
										channel: { type: 'string' },
										minutes: { type: 'integer' },
										messagesScanned: { type: 'integer' },
										uniqueChatters: { type: 'integer' },
										candidates: {
											type: 'array',
											items: {
												type: 'object',
												properties: {
													userId: { type: 'string' },
													username: { type: 'string' },
													channelUrl: { type: 'string' },
													messages: { type: 'integer' },
													game: { type: 'string', nullable: true },
													viewers: { type: 'integer' },
													startedAt: { type: 'string', nullable: true },
													monitored: { type: 'boolean', nullable: true },
													reason: { type: 'string', nullable: true },
												},
											},
										},
										usernames: { type: 'string', description: 'Comma-separated logins' },
									},
								},
							},
						},
					},
					400: { description: 'channel missing or invalid' },
					401: { description: 'Unauthorized' },
				},
			},
		},
	},
});

module.exports = { createOpenApiSpec };
