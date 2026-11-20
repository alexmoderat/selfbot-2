const express = require('express');
const { got, fetchTwitchUser, one, lower, requireApiKey, route } = require('../../v1.js');

const router = express.Router();

router.delete(
	'/v1/twitch/blockedterm',
	requireApiKey,
	route(async (req, res) => {
		const body = req.body ?? {};
		const channel = lower(one(req.query.channel) || body.channel);
		const termId = one(req.query.id) || one(body.id);
		if (!channel || !termId) {
			return res.status(400).json({ error: 'Missing: channel, id' });
		}
		const user = await fetchTwitchUser(channel);
		if (!user) {
			return res.status(404).json({ error: 'Channel nicht gefunden' });
		}
		const twitch = bot.Twitch;
		const response = await got('Helix')({
			method: 'DELETE',
			url: 'moderation/blocked_terms',
			searchParams: { broadcaster_id: user.id, moderator_id: twitch.selfId, id: termId },
			responseType: 'text',
		});
		if (response.statusCode === 401) return res.status(401).json({ error: 'Bot-Token ungültig' });
		if (response.statusCode === 403) return res.status(403).json({ error: 'Bot ist kein Mod in diesem Channel' });
		if (response.statusCode === 404) return res.status(404).json({ error: 'Term nicht gefunden' });
		if (!response.ok) return res.status(500).json({ error: `Request failed with status code ${response.statusCode}` });
		return res.json({ success: true, channel, id: termId });
	}),
);

module.exports = router;
