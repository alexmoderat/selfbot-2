const { readdirSync } = require('node:fs');
const path = require('node:path');
const express = require('express');
const swaggerUi = require('swagger-ui-express');

const { Logger, LogLevel } = require('../misc/logger.js');
const { PUBLIC_DIR } = require('./context.js');
const { createOpenApiSpec } = require('./openapi.js');
const { cleanExpiredSessions } = require('./sessions.js');
const { baseUrl } = require('../token/user-tokens.js');

/**
 * Web-Server wie DontAddThisBots api/server.js: jede Datei in routes/<METHODE>/ exportiert einen express.Router und wird
 * automatisch geladen (OAuth, Dashboard, Status-/Statistikseiten, /v1-API). Die Reihenfolge (GET, POST, PUT, PATCH,
 * DELETE, dann alphabetisch) ist fest, damit sich Routen mit gleichem Pfad immer gleich aufloesen.
 */
const ROUTES_DIR = path.join(__dirname, 'routes');
const METHOD_ORDER = ['GET', 'POST', 'PUT', 'PATCH', 'DELETE'];

const loadRoutes = (app) => {
	const folders = readdirSync(ROUTES_DIR).sort((a, b) => METHOD_ORDER.indexOf(a) - METHOD_ORDER.indexOf(b));
	for (const folder of folders) {
		for (const file of readdirSync(path.join(ROUTES_DIR, folder))
			.filter((i) => i.endsWith('.js'))
			.sort()) {
			app.use(require(path.join(ROUTES_DIR, folder, file)));
			Logger.log(LogLevel.DEBUG, `[${folder}] Endpoint ${file} is running!`);
		}
	}
};

const startWebServer = (port) => {
	const app = express();
	app.set('trust proxy', 'loopback');
	// Rohtext nur fuer den GitHub-Webhook (Signaturpruefung)
	app.use(
		express.json({
			verify: (req, res, buf) => {
				if (req.url.startsWith('/github/')) req.rawBody = buf;
			},
		}),
	);
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
	loadRoutes(app);

	const server = app.listen(port, '127.0.0.1', () => {
		Logger.info(`[web] lauscht auf 127.0.0.1:${port} (${baseUrl() || 'ohne WEB_BASE_URL'})`);
	});
	// Zusatz-Port nur lokal (config.web.compatPort, bisher WEB_COMPAT_PORT=3000): der 24/7-Stream (badges-stream.sh)
	// oeffnete sb-v2s http://localhost:3000/stats und haelt diese Adresse bis zum naechsten Stream-Zyklus (24.10.2026).
	// Im Parallelbetrieb null - Port 3000 gehoert noch dem alten selfbot.
	const compatPort = bot.Config.web?.compatPort;
	if (compatPort) {
		app.listen(Number(compatPort), '127.0.0.1', () => {
			Logger.info(`[web] zusaetzlich auf 127.0.0.1:${compatPort} (alter sb-v2-Port)`);
		});
	}
	setInterval(() => void cleanExpiredSessions().catch(() => {}), 15 * 60_000).unref();
	return server;
};

module.exports = { startWebServer, loadRoutes };
