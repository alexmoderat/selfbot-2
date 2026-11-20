const express = require('express');
const {
	existsSync,
	writeFileSync,
	path,
	JOIN_MESSAGE_DELAY,
	joinByLogin,
	joinMessages,
	markModerator,
	storeBotRefreshToken,
	getUserToken,
	ADD_BOT_SCOPES,
	USER_SCOPES,
	authClient,
	buildAuthorizeUrl,
	consumeState,
	createState,
	exchangeCode,
	getToken,
	helixAsUser,
	saveToken,
	validateToken,
	listReminderHistory,
	listReminders,
	COOKIE,
	LOGIN_COOKIE,
	SESSION_TTL,
	createLogin,
	createSession,
	currentLogin,
	deleteLogin,
	deleteSession,
	getSession,
	parseCookies,
	link,
	page,
	text,
	noStore,
	query,
	locationRoute,
	locationView,
} = require('../../auth.js');

const { PUBLIC_DIR: publicDir, basePath } = require('../../context.js');

const router = express.Router();

router.get('/', async (req, res) => {
	// Schon angemeldet: gleich ins Dashboard (ninou2, 27.10.2026: "if i logged once, i should not get the ADD to MY
	// CHANNEL message")
	const token = parseCookies(req)[COOKIE];
	if (token && (await getSession(token).catch(() => null))) {
		noStore(res);
		res.redirect(`${basePath}/dashboard`);
		return;
	}

	const indexFile = path.join(publicDir, 'index.html');
	if (existsSync(indexFile)) {
		res.sendFile(indexFile);
		return;
	}
	const twitch = bot.Twitch;
	const existing = await getToken(twitch.selfName);
	res.send(page(existing ? '✅ Bot is authorized' : '⚠️ Bot not authorized', link(`${basePath}/bot-auth`, existing ? '🔄 Re-authorize Bot' : '✅ Authorize Bot')));
});

router.get('/auth/:username', async (req, res) => {
	noStore(res);
	const client = authClient();
	if (!client) {
		res.status(503).send(page('Authorization is not configured.'));
		return;
	}
	const state = await createState({ type: 'user', username: String(req.params.username).toLowerCase() });
	res.redirect(buildAuthorizeUrl({ clientId: client.id, redirectPath: '/callback', scopes: USER_SCOPES, state, forceVerify: false }));
});

// Ohne no-store cachte der Browser den Redirect samt altem state (alexmoderat, 07.10.2026)
// Ohne Berechtigungen, ohne gespeicherten Token, ohne Bot-Beitritt und ohne Dashboard
router.get('/login', async (_req, res) => {
	noStore(res);
	const client = authClient();
	if (!client) {
		res.status(503).send(page('Authorization is not configured.'));
		return;
	}
	const state = await createState({ type: 'login' });
	res.redirect(buildAuthorizeUrl({ clientId: client.id, redirectPath: '/callback', scopes: [], state, forceVerify: false }));
});

router.get('/api/login', async (req, res) => {
	noStore(res);
	res.json({ login: await currentLogin(req) });
});

router.get(
	'/api/my/location',
	locationRoute(async (user, _req, res) => {
		res.json(locationView(await bot.Users.getData(user, 'location')));
	}),
);

router.get(
	'/api/my/sidebar',
	locationRoute(async (user, _req, res) => {
		res.json({ sidebar: await bot.Users.getData(user, 'dashboardSidebar') });
	}),
);

router.get(
	'/api/my/reminders/history',
	locationRoute(async (user, _req, res) => {
		res.json({ reminders: await listReminderHistory(user) });
	}),
);

router.get(
	'/api/my/reminders',
	locationRoute(async (user, _req, res) => {
		res.json({ reminders: await listReminders(user) });
	}),
);

// ninou2, 03.11.2026: "under my location add another box: MY TIMEZONE". Derselbe Wert wie bei !uts
router.get(
	'/api/my/timezone',
	locationRoute(async (user, _req, res) => {
		res.json({ timezone: await bot.Users.getData(user, 'timezone') });
	}),
);

router.get('/login/logout', async (req, res) => {
	noStore(res);
	const cookies = parseCookies(req);
	if (cookies[LOGIN_COOKIE]) {
		await deleteLogin(cookies[LOGIN_COOKIE]).catch(() => {});
	}
	if (cookies[COOKIE]) {
		await deleteSession(cookies[COOKIE]).catch(() => {});
	}
	res.setHeader('Set-Cookie', [`${LOGIN_COOKIE}=; Path=${basePath || '/'}; HttpOnly; Max-Age=0`, `${COOKIE}=; Path=${basePath || '/'}; HttpOnly; Max-Age=0`]);
	res.redirect(`${basePath}/commands`);
});

router.get('/add-bot', async (req, res) => {
	noStore(res);
	const client = authClient();
	if (!client) {
		res.status(503).send(page('Authorization is not configured.'));
		return;
	}
	// Die Mod-Berechtigung wird nur mit gesetztem Haekchen abgefragt
	const mod = query(req, 'mod') === '1';
	const state = await createState({ type: 'add_bot', mod });
	const scopes = mod ? [...ADD_BOT_SCOPES, 'channel:manage:moderators'] : ADD_BOT_SCOPES;
	res.redirect(buildAuthorizeUrl({ clientId: client.id, redirectPath: '/callback', scopes, state, forceVerify: false }));
});

router.get('/stats-stream-auth', async (_req, res) => {
	noStore(res);
	const client = authClient();
	if (!client) {
		res.status(503).send(page('Authorization is not configured.'));
		return;
	}
	const state = await createState({ type: 'stats_stream' });
	res.redirect(buildAuthorizeUrl({ clientId: client.id, redirectPath: '/callback', scopes: ['channel:manage:broadcast'], state, forceVerify: true }));
});

// Bot-Konto ueber die eigene App, mit denselben Scopes wie der aktuelle Token
router.get('/bot-auth', async (_req, res) => {
	noStore(res);
	// Auch ein widerrufener Token darf den Login nicht blockieren - genau dafuer ist die Route da
	const current = await getUserToken()
		.then(validateToken)
		.catch(() => null);
	const state = await createState({ type: 'bot' });
	res.redirect(
		buildAuthorizeUrl({
			clientId: process.env.TWITCH_CLIENT_ID ?? '',
			redirectPath: '/bot-callback',
			scopes: current?.scopes ?? USER_SCOPES,
			state,
			forceVerify: true,
		}),
	);
});

router.get('/callback', async (req, res) => {
	const code = query(req, 'code');
	const state = query(req, 'state');
	if (query(req, 'error')) {
		res.send(page('Authorization denied.'));
		return;
	}
	const pending = code && state ? await consumeState(state) : null;
	const client = authClient();
	if (!pending || !client) {
		res.send(page('Invalid or expired link.'));
		return;
	}

	try {
		const token = await exchangeCode(code, client, '/callback');
		const owner = await validateToken(token.access_token);
		if (!owner) {
			res.send(page('Failed to get user info.'));
			return;
		}
		const login = owner.login.toLowerCase();

		if (pending.type === 'stats_stream') {
			const file = path.join(__dirname, '..', '..', 'stats-stream-token.json');
			writeFileSync(file, JSON.stringify({ access_token: token.access_token, refresh_token: token.refresh_token, channel_id: owner.user_id, login }, null, 2));
			console.log(`[web] Stats-Stream-Token gespeichert fuer ${login}`);
			res.send(page('✅ Stats stream authorized!', text(`Account: ${owner.login}`)));
			return;
		}

		if (pending.type === 'login') {
			// Channel mit aktivem Bot: direkt ins Dashboard. Sonst nur angemeldet, beigetreten wird erst ueber "Join your channel"
			const channel = bot.Channels.getByTwitchId(owner.user_id) ?? bot.Channels.get(login);
			if (channel && channel.mode !== 'Inactive') {
				const sessionToken = await createSession({ username: owner.login, userId: owner.user_id, channel: channel.name, displayName: owner.login });
				res.setHeader('Set-Cookie', `${COOKIE}=${sessionToken}; Path=${basePath || '/'}; HttpOnly; Max-Age=${SESSION_TTL / 1000}; SameSite=Lax`);
				res.redirect(`${basePath}/dashboard`);
				return;
			}

			const loginToken = await createLogin({ username: login, userId: owner.user_id, displayName: owner.login });
			res.setHeader('Set-Cookie', `${LOGIN_COOKIE}=${loginToken}; Path=${basePath || '/'}; HttpOnly; Secure; Max-Age=${SESSION_TTL / 1000}; SameSite=Lax`);
			res.redirect(`${basePath}/dashboard#join`);
			return;
		}

		if (pending.type === 'add_bot') {
			await saveToken(login, owner.user_id, token);
			const twitch = bot.Twitch;
			let modded = false;
			if (pending.mod && owner.user_id !== twitch.selfId) {
				// 204 = jetzt Mod, 422 = war schon Mod
				const response = await helixAsUser(token.access_token, {
					method: 'POST',
					url: 'moderation/moderators',
					searchParams: { broadcaster_id: owner.user_id, user_id: twitch.selfId },
				}).catch((e) => {
					console.warn(`[web] Bot konnte in #${login} nicht gemoddet werden`, e);
					return null;
				});
				modded = response?.statusCode === 204 || response?.statusCode === 422;
				if (response && !modded) {
					console.warn(`[web] Bot in #${login} nicht gemoddet: Status ${response.statusCode}`);
				}
			}

			const result = await joinByLogin(login);
			console.log(`[web] Bot hinzugefuegt: ${login} (${result.status}, modded: ${modded})`);
			if (result.status === 'joined' || (result.status === 'already' && modded && result.channel.mode !== 'Moderator')) {
				// Twitchs Mod-Liste kann nachhinken: dann den Mode selbst setzen und die Mod-Abos nachziehen
				if (modded && result.channel.mode !== 'Moderator') {
					await markModerator(result.channel).catch((e) => console.warn(`[web] Abos von #${login} nicht aktualisiert`, e));
				}

				// Im Hintergrund, damit die Weiterleitung nicht auf die Wartezeit zwischen den Nachrichten wartet
				const { channel } = result;
				void (async () => {
					for (const [index, message] of joinMessages(twitch.selfName, channel.mode === 'Moderator', 'sb').entries()) {
						if (index > 0) {
							await new Promise((resolve) => setTimeout(resolve, JOIN_MESSAGE_DELAY));
						}
						await bot.Channels.send(channel, message);
					}
				})().catch((e) => console.warn(`[web] Beitrittsmeldung in #${login} fehlgeschlagen`, e));
			}
			const sessionToken = await createSession({ username: owner.login, userId: owner.user_id, channel: login, displayName: owner.login });
			res.setHeader('Set-Cookie', `${COOKIE}=${sessionToken}; Path=${basePath || '/'}; HttpOnly; Max-Age=${SESSION_TTL / 1000}; SameSite=Lax`);
			res.redirect(`${basePath}/dashboard`);
			return;
		}

		// Der Link gilt nur fuer das genannte Konto - sonst landete fremder Token unter falschem Namen
		// (alexmoderat, 29.09.2026: commanderroot-Slot enthielt ninou2s Token)
		if (login !== pending.username) {
			console.warn(`[web] /auth/${pending.username}: Token von ${login} abgelehnt`);
			res.send(page('❌ Wrong account', text(`This link was for ${pending.username}, but you authorized as ${login}. Use the link for your own account instead.`)));
			return;
		}

		await saveToken(login, owner.user_id, token);
		res.send(page('✅ Authorized!', text('You can now use followage and the other commands that need your authorization.')));
	} catch (e) {
		console.warn('[web] OAuth-Callback fehlgeschlagen', e);
		res.send(page('Error during authorization.'));
	}
});

router.get('/bot-callback', async (req, res) => {
	const code = query(req, 'code');
	const pending = code ? await consumeState(query(req, 'state')) : null;
	if (!pending || pending.type !== 'bot' || !process.env.TWITCH_CLIENT_ID || !process.env.TWITCH_CLIENT_SECRET) {
		res.send(page('Invalid or expired link.'));
		return;
	}

	try {
		const token = await exchangeCode(code, { id: process.env.TWITCH_CLIENT_ID, secret: process.env.TWITCH_CLIENT_SECRET }, '/bot-callback');
		const owner = await validateToken(token.access_token);
		const twitch = bot.Twitch;
		if (owner?.login.toLowerCase() !== twitch.selfName) {
			res.send(page('❌ Wrong account', text(`You must authorize as ${twitch.selfName}, not ${owner?.login ?? '?'}.`)));
			return;
		}
		if (!token.refresh_token) {
			res.send(page('Error during authorization.', text('No refresh token received.')));
			return;
		}

		await storeBotRefreshToken(token.refresh_token);
		console.log('[web] Bot-Konto neu autorisiert');
		res.send(page('✅ Bot authorized!', text('The new token is used from the next request on.')));
	} catch (e) {
		console.warn('[web] Bot-Callback fehlgeschlagen', e);
		res.send(page('Error during authorization.'));
	}
});

router.get('/dashboard', (_req, res) => {
	const file = path.join(publicDir, 'dashboard.html');
	if (existsSync(file)) {
		res.sendFile(file);
		return;
	}
	res.redirect(`${basePath}/`);
});

router.get('/logout', async (req, res) => {
	const token = parseCookies(req)[COOKIE];
	if (token) {
		await deleteSession(token).catch(() => {});
	}
	res.setHeader('Set-Cookie', `${COOKIE}=; Path=${basePath || '/'}; HttpOnly; Max-Age=0`);
	res.redirect(`${basePath}/`);
});

module.exports = router;
