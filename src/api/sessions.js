const { randomBytes } = require('node:crypto');

// Dashboard-Sitzungen (Cookie sbsession, 7 Tage), aus sb-v2s sessions-maria
// 90 statt 7 Tage: einmal anmelden soll reichen (ninou2, 27.10.2026)
const SESSION_TTL = 90 * 24 * 60 * 60 * 1000;
const COOKIE = 'sbsession';

// Reiner Twitch-Login fuer die Befehlsseite (ninou2, 03.11.2026: "add a log in button"): eigene Tabelle und eigenes Cookie,
// damit ein Login-Token nie als Dashboard-Sitzung gilt - /add-bot laesst den Bot beitreten, das soll kein Login ausloesen
const LOGIN_COOKIE = 'sblogin';

const parseCookies = (req) => {
	const out = {};
	for (const part of (req.headers.cookie ?? '').split(';')) {
		const [key, ...value] = part.split('=');
		if (key.trim()) {
			out[key.trim()] = decodeURIComponent(value.join('=').trim());
		}
	}
	return out;
};

const createSession = async (data) => {
	const token = randomBytes(32).toString('hex');
	const row = await bot.DB.getRow('WebSession');
	row.setValues({
		Token: token,
		Username: data.username,
		User_ID: data.userId,
		Channel: data.channel,
		Display_Name: data.displayName,
		Expires: Date.now() + SESSION_TTL,
	});
	await row.save({ skipLoad: true });
	return token;
};

const getSession = async (token) => {
	const row = bot.DB.toRow('WebSession', await bot.DB.WebSession.findOne({ token }).lean());
	if (!row || Number(row.Expires) < Date.now()) {
		return null;
	}
	return { username: row.Username, userId: row.User_ID, channel: row.Channel, displayName: row.Display_Name };
};

const createLogin = async (data) => {
	const token = randomBytes(32).toString('hex');
	const row = await bot.DB.getRow('WebLogin');
	row.setValues({
		Token: token,
		Username: data.username,
		User_ID: data.userId,
		Display_Name: data.displayName,
		Expires: Date.now() + SESSION_TTL,
	});
	await row.save({ skipLoad: true });
	return token;
};

const getLogin = async (token) => {
	const row = bot.DB.toRow('WebLogin', await bot.DB.WebLogin.findOne({ token }).lean());
	if (!row || Number(row.Expires) < Date.now()) {
		return null;
	}
	return { username: row.Username, userId: row.User_ID, displayName: row.Display_Name };
};

const deleteLogin = async (token) => {
	await bot.DB.WebLogin.deleteOne({ token });
};

/** Wer auf der Befehlsseite angemeldet ist: reiner Login oder bestehende Dashboard-Sitzung */
const currentLogin = async (req) => {
	const cookies = parseCookies(req);
	const login = cookies[LOGIN_COOKIE] ? await getLogin(cookies[LOGIN_COOKIE]).catch(() => null) : null;
	if (login) {
		return { username: login.username, displayName: login.displayName };
	}
	const session = cookies[COOKIE] ? await getSession(cookies[COOKIE]).catch(() => null) : null;
	return session ? { username: session.username, displayName: session.displayName } : null;
};

const deleteSession = async (token) => {
	await bot.DB.WebSession.deleteOne({ token });
};

const cleanExpiredSessions = async () => {
	await bot.DB.WebSession.deleteMany({ expires: { $lt: Date.now() } });
	await bot.DB.WebLogin.deleteMany({ expires: { $lt: Date.now() } });
};

const requireSession = async (req, res, next) => {
	const token = parseCookies(req)[COOKIE];
	if (!token) {
		res.status(401).json({ error: 'Not authenticated' });
		return;
	}
	const session = await getSession(token).catch(() => null);
	if (!session) {
		res.status(401).json({ error: 'Session expired' });
		return;
	}
	req.sess = session;
	next();
};

/** Bot-Besitzer (eigener Channel) oder Administrator (sb-v2: Tabelle admins) */
const isAdminLogin = async (login) => {
	const twitch = bot.Twitch;
	if (login.toLowerCase() === twitch.selfName) {
		return true;
	}
	const user = await bot.Users.get(login.toLowerCase());
	return Boolean(user && (await bot.Users.getData(user, 'administrator')) === true);
};

const requireAdmin = async (req, res, next) => {
	if (!req.sess) {
		res.status(401).json({ error: 'Not authenticated' });
		return;
	}
	if (!(await isAdminLogin(req.sess.channel))) {
		res.status(403).json({ error: 'Admin only' });
		return;
	}
	next();
};

module.exports = {
	SESSION_TTL,
	COOKIE,
	LOGIN_COOKIE,
	parseCookies,
	createSession,
	getSession,
	createLogin,
	getLogin,
	deleteLogin,
	currentLogin,
	deleteSession,
	cleanExpiredSessions,
	requireSession,
	isAdminLogin,
	requireAdmin,
};
