const express = require('express');
const { runPublicCommand, route } = require('../../public.js');

const router = express.Router();

router.post(
	'/api/commands/run',
	route(async (req, res) => {
		const body = req.body ?? {};
		const result = await runPublicCommand({ channel: body.channel, input: body.input, ip: req.ip ?? 'unknown' });
		if ('retryAfter' in result && result.retryAfter) {
			res.setHeader('Retry-After', String(result.retryAfter));
		}

		return res.status(result.status).json('replies' in result ? { replies: result.replies } : { error: result.error });
	}),
);

module.exports = router;
