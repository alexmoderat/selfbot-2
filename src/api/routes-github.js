const crypto = require('node:crypto');
const express = require('express');
const { formatGithubEvent } = require('../misc/github-events.js');

/**
 * POST /github/webhook: GitHub-Webhook (Content type application/json, Secret GITHUB_WEBHOOK_SECRET). Prueft die Signatur
 * (X-Hub-Signature-256 ueber den Rohtext), dedupliziert ueber X-GitHub-Delivery und schreibt den Text in den Channel
 * GITHUB_WATCH_CHANNEL (Standard alexmoderat). Ohne Secret antwortet die Route mit 503.
 */
const SEEN_MAX = 200;
const seen = new Set();

const validSignature = (secret, rawBody, header) => {
	if (!secret || !rawBody || typeof header !== 'string') {
		return false;
	}
	const expected = `sha256=${crypto.createHmac('sha256', secret).update(rawBody).digest('hex')}`;
	const a = Buffer.from(expected);
	const b = Buffer.from(header);
	return a.length === b.length && crypto.timingSafeEqual(a, b);
};

const isDuplicate = (id) => {
	if (!id) {
		return false;
	} else if (seen.has(id)) {
		return true;
	}
	seen.add(id);
	if (seen.size > SEEN_MAX) {
		seen.delete(seen.values().next().value);
	}
	return false;
};

const createGithubRouter = () => {
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
		const channel = bot.Channels.get(process.env.GITHUB_WATCH_CHANNEL || 'alexmoderat');
		if (text && channel) {
			await bot.Channels.send(channel, text).catch((e) => console.warn(`[github] senden: ${e?.message}`));
		}
	});
	return router;
};

module.exports = { createGithubRouter, validSignature, isDuplicate };
