const { Logger } = require('../misc/logger.js');
const { commands } = require('../commandHandler.js');
const { createServer } = require('node:http');
const { pubsub } = require('../util/pubsub.js');
const { getRecent } = require('../util/event-feed.js');
const { getRecentActions } = require('../util/moderation.js');

// Interne API wie Supibots api/index.ts - nur 127.0.0.1, fuer Website/Statusseite (Block 9).

const routes = {
	'/health': () => ({
		statusCode: 200,
		data: { status: 'ok', uptime: process.uptime(), pubsub: pubsub.status() },
	}),
	'/command/list': () => ({
		statusCode: 200,
		data: [...commands.values()].map((i) => ({
			name: i.Name,
			aliases: i.Aliases,
			description: i.Description,
			cooldown: i.Cooldown,
			flags: i.Flags,
		})),
	}),
	'/events': (url) => ({
		statusCode: 200,
		data: getRecent(Math.min(Number(url.searchParams.get('limit')) || 300, 300)),
	}),
	'/mod-actions': () => ({
		statusCode: 200,
		data: getRecentActions(),
	}),
	'/channel/list': () => ({
		statusCode: 200,
		data: [...bot.Channels.all()].map((i) => ({
			id: i.ID,
			name: i.Name,
			platform: i.Platform.name,
			mode: i.Mode,
		})),
	}),
};

module.exports = function initializeInternalApi(port) {
	const server = createServer((req, res) => {
		const url = new URL(req.url ?? '/', 'http://localhost');
		const handler = routes[url.pathname];

		const respond = (result) => {
			res.writeHead(result.statusCode, { 'Content-Type': 'application/json' });
			res.end(JSON.stringify({ statusCode: result.statusCode, data: result.data, timestamp: Date.now() }));
		};

		if (req.method !== 'GET' || !handler) {
			respond({ statusCode: 404, data: null });
			return;
		}

		Promise.resolve(handler(url))
			.then(respond)
			.catch((e) => {
				Logger.warn('[api] Fehler', e);
				respond({ statusCode: 500, data: null });
			});
	});

	server.listen(port, '127.0.0.1');
	return server;
};
