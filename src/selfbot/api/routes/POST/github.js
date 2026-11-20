const express = require('express');
const { formatGithubEvent, sendAlert, validSignature, isDuplicate } = require('../../github.js');

const router = express.Router();

router.post('/github/webhook', async (req, res) => {
	const secret = process.env.GITHUB_WEBHOOK_SECRET;
	if (!secret) {
		return res.status(503).json({ error: 'webhook not configured' });
	} else if (!validSignature(secret, req.rawBody, req.get('x-hub-signature-256'))) {
		return res.status(401).json({ error: 'invalid signature' });
	}

	res.status(204).end();
	if (isDuplicate(req.get('x-github-delivery'))) {
		return;
	}
	const text = formatGithubEvent(req.get('x-github-event'), req.body);
	if (text) {
		await sendAlert(text).catch((e) => console.warn(`[github] senden: ${e?.message}`));
	}
});

module.exports = router;
