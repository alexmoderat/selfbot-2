const { Logger } = require('../misc/logger.js');
const { existsSync, writeFileSync } = require('node:fs');

const path = require('node:path');

const { Router } = require('express');

const { JOIN_MESSAGE_DELAY, joinByLogin, joinMessages, markModerator } = require('../util/channel-manager.js');

const { storeBotRefreshToken, getUserToken } = require('../util/twitch/twitch-utils.js');

const {
	ADD_BOT_SCOPES,
	USER_SCOPES,
	authClient,
	baseUrl,
	buildAuthorizeUrl,
	consumeState,
	createState,
	exchangeCode,
	getToken,
	helixAsUser,
	saveToken,
	validateToken,
} = require('../token/user-tokens.js');

const { isResultFailure } = require('../clients/modules/commands.js');

const { fetchGeoLocationData, toUserLocation } = require('../util/command-utils.js');

const { detectTimezone } = require('../util/timezones.js');

const { checkRunLimits } = require('./command-runner.js');

const { MAX_REMINDER_TEXT, editReminder, isReminderSource, listReminderHistory, listReminders, removeReminder } = require('./reminders.js');

const { COOKIE, LOGIN_COOKIE, SESSION_TTL, createLogin, createSession, currentLogin, deleteLogin, deleteSession, getSession, parseCookies } = require('./sessions.js');

const { link, page, text } = require('./html.js');

const noStore = (res) => res.set('Cache-Control', 'no-store');

const query = (req, key) => {
	const value = req.query[key];
	return Array.isArray(value) ? String(value[0] ?? '') : value === undefined ? '' : String(value);
};

// ninou2, 03.11.2026: "i set [it] on website and make it private from there" - !set location zeigt den Ort sonst im Chat.
// Der Suchbegriff wird bewusst nicht geloggt.
const locationRoute = (handler) => async (req, res) => {
	noStore(res);
	try {
		const login = await currentLogin(req);
		if (!login) {
			res.status(401).json({ error: 'Log in first.' });
			return;
		}

		const user = await bot.Users.get(login.username);
		if (!user) {
			res.status(404).json({ error: 'Write one message in a chat with the bot first, then try again.' });
			return;
		}

		await handler(user, req, res);
	} catch (e) {
		// Nur der Fehlertext: der Suchbegriff eines Orts soll nicht im Log landen
		Logger.warn('[web] /api/my fehlgeschlagen:', e instanceof Error ? e.message.slice(0, 200) : 'unbekannt');
		res.status(500).json({ error: 'That did not work, try again later.' });
	}
};

const locationView = (location) => ({ location: location ? { formatted: location.formatted, hidden: location.hidden } : null });

// ninou2, 07.11.2026: Seitenleiste selbst sortieren (Bereiche und Tabs), gespeichert am Login
const SIDEBAR_KEY = /^[a-z0-9-]{1,40}$/;

module.exports = {
	existsSync,
	writeFileSync,
	path,
	Router,
	JOIN_MESSAGE_DELAY,
	joinByLogin,
	joinMessages,
	markModerator,
	storeBotRefreshToken,
	getUserToken,
	ADD_BOT_SCOPES,
	USER_SCOPES,
	authClient,
	baseUrl,
	buildAuthorizeUrl,
	consumeState,
	createState,
	exchangeCode,
	getToken,
	helixAsUser,
	saveToken,
	validateToken,
	isResultFailure,
	fetchGeoLocationData,
	toUserLocation,
	detectTimezone,
	checkRunLimits,
	MAX_REMINDER_TEXT,
	editReminder,
	isReminderSource,
	listReminderHistory,
	listReminders,
	removeReminder,
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
	SIDEBAR_KEY,
};
