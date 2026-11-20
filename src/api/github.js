const crypto = require('node:crypto');

const express = require('express');

const { formatGithubEvent } = require('../util/github-events.js');

const { sendAlert } = require('../util/moderation.js');

/**
 * POST /github/webhook: GitHub-Webhook (Content type application/json, Secret GITHUB_WEBHOOK_SECRET). Prueft die Signatur
 * (X-Hub-Signature-256 ueber den Rohtext), dedupliziert ueber X-GitHub-Delivery und schickt den Text per Discord (sendAlert). Ohne Secret antwortet die Route mit 503.
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

module.exports = {
	crypto,
	express,
	formatGithubEvent,
	sendAlert,
	SEEN_MAX,
	seen,
	validSignature,
	isDuplicate,
};
