const express = require('express');
const { sbv2, one, route } = require('../../v1.js');

const router = express.Router();

router.post(
	'/v1/bots',
	(req, res, next) => {
		const token = one(req.query.token) || (req.headers.authorization ?? '').replace('Bearer ', '').trim();
		const expected = process.env.WEB_BOTLIST_UPLOAD_TOKEN;
		if (!token || !expected || token !== expected) {
			res.status(401).json({ error: 'Unauthorized' });
			return;
		}
		next();
	},
	route(async (req, res) => {
		const bots = Array.isArray(req.body) ? req.body : [req.body];
		let added = 0;
		// "entry" statt "bot": "bot" ist hier das globale Bot-Objekt
		for (const entry of bots) {
			if (!entry.login) {
				continue;
			}
			// chat_data.known_bots gehoert dem autojoin-bot (geteilte sb-v2-Daten in MariaDB)
			await sbv2.query(
				'INSERT INTO chat_data.known_bots (login, user_id, source) VALUES (?, ?, ?) ON DUPLICATE KEY UPDATE user_id = COALESCE(VALUES(user_id), user_id), source = COALESCE(VALUES(source), source)',
				[entry.login.toLowerCase(), entry.user_id ? String(entry.user_id) : null, entry.source ?? null],
			);
			added++;
		}
		return res.json({ success: true, added });
	}),
);

module.exports = router;
