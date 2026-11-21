const express = require('express');
const { requireSession, route, sessionChannel, str, fetchTwitchUser } = require('../../dashboard.js');
const editors = require('../../../util/channel-editors.js');

const router = express.Router();

router.post(
	'/api/editors',
	requireSession,
	route(async (req, res) => {
		const channel = sessionChannel(req, res);
		if (!channel) {
			return;
		}
		const login = str(req.body.username).trim().toLowerCase().replace(/^@/, '');
		if (!/^[a-z0-9_]{1,25}$/.test(login)) {
			res.status(400).json({ error: 'invalid username' });
			return;
		}
		const user = await fetchTwitchUser(login);
		if (!user) {
			res.status(404).json({ error: 'user not found' });
			return;
		}
		const result = await editors.add(channel, user);
		if (result.error) {
			res.status(400).json({ error: result.error });
			return;
		}
		res.json(result.editors);
	}),
);

module.exports = router;
