const express = require('express');
const { requireSession, route, sessionChannel } = require('../../dashboard.js');
const editors = require('../../../util/channel-editors.js');

// Channel-Editoren (Dashboard-Seite "Editors"): wer im eigenen Channel Donts 7TV-Commands nutzen darf

const router = express.Router();

router.get(
	'/api/editors',
	requireSession,
	route(async (req, res) => {
		const channel = sessionChannel(req, res);
		if (channel) {
			res.json(await editors.list(channel));
		}
	}),
);

module.exports = router;
