const express = require('express');
const { requireSession, route, sessionChannel } = require('../../dashboard.js');
const editors = require('../../../util/channel-editors.js');

const router = express.Router();

router.delete(
	'/api/editors/:username',
	requireSession,
	route(async (req, res) => {
		const channel = sessionChannel(req, res);
		if (!channel) {
			return;
		}
		const result = await editors.remove(channel, req.params.username);
		if (result.error) {
			res.status(404).json({ error: result.error });
			return;
		}
		res.json(result.editors);
	}),
);

module.exports = router;
