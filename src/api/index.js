const path = require('node:path');
const express = require('express');
const swaggerUi = require('swagger-ui-express');

const { createAuthRouter } = require('./routes-auth.js');
const { createDashboardRouter } = require('./routes-dashboard.js');
const { createPublicRouter } = require('./routes-public.js');
const { createV1Router } = require('./routes-v1.js');
const { createOpenApiSpec } = require('./openapi.js');
const { cleanExpiredSessions } = require('./sessions.js');
const { baseUrl } = require('../misc/user-tokens.js');

/**
 * Web-Server (Block 9), Nachfolger von sb-v2s auth-server.ts: OAuth, Dashboard, Status-/Statistikseiten, /v1-API.
 * Laeuft hinter nginx unter WEB_BASE_URL (Testphase: https://auth.alexmoderat.eu/selfbot, Prefix wird abgeschnitten);
 * die Seiten in public/ verwenden deshalb relative Pfade.
 */
const PUBLIC_DIR = path.join(__dirname, 'public');

const startWebServer = (port) => {
	const basePath = (() => {
		try {
			return new URL(baseUrl()).pathname.replace(/\/+$/, '');
		} catch {
			return '';
		}
	})();

	const app = express();
	app.set('trust proxy', 'loopback');
	app.use(express.json());
	app.use(
		express.static(PUBLIC_DIR, {
			etag: false,
			lastModified: false,
			extensions: ['html'],
			index: false,
			setHeaders: (res) => res.setHeader('Cache-Control', 'no-store'),
		}),
	);
	app.use('/docs', swaggerUi.serve, swaggerUi.setup(createOpenApiSpec()));

	app.use(createAuthRouter(PUBLIC_DIR, basePath));
	app.use(createPublicRouter());
	app.use(createDashboardRouter());
	app.use(createV1Router());

	const server = app.listen(port, '127.0.0.1', () => {
		console.log(`[web] lauscht auf 127.0.0.1:${port} (${baseUrl() || 'ohne WEB_BASE_URL'})`);
	});
	// Zusatz-Port nur lokal (config.web.compatPort, bisher WEB_COMPAT_PORT=3000): der 24/7-Stream (badges-stream.sh)
	// oeffnete sb-v2s http://localhost:3000/stats und haelt diese Adresse bis zum naechsten Stream-Zyklus (24.10.2026).
	// Im Parallelbetrieb null - Port 3000 gehoert noch dem alten selfbot.
	const compatPort = bot.Config.web?.compatPort;
	if (compatPort) {
		app.listen(Number(compatPort), '127.0.0.1', () => {
			console.log(`[web] zusaetzlich auf 127.0.0.1:${compatPort} (alter sb-v2-Port)`);
		});
	}
	setInterval(() => void cleanExpiredSessions().catch(() => {}), 15 * 60_000).unref();
	return server;
};

module.exports = { startWebServer };
