const express = require('express');
const {
	isResultFailure,
	fetchGeoLocationData,
	toUserLocation,
	detectTimezone,
	checkRunLimits,
	locationRoute,
	locationView,
	SIDEBAR_KEY,
} = require('../../auth.js');

const router = express.Router();

router.post(
	'/api/my/location',
	locationRoute(async (user, req, res) => {
		const retryAfter = checkRunLimits(req.ip ?? 'unknown', { Name: 'my-location', Cooldown: 3000 }, Date.now());
		if (retryAfter > 0) {
			res.status(429).json({ error: `Slow down, try again in ${retryAfter}s.` });
			return;
		}

		const body = req.body ?? {};
		const query = String(body.query ?? '').trim();
		if (!query || query.length > 200) {
			res.status(400).json({ error: 'Enter a location.' });
			return;
		}

		const result = await fetchGeoLocationData(query);
		if (!result.success) {
			res.status(404).json({ error: 'No location found.' });
			return;
		}

		const location = toUserLocation(result, body.hidden !== false);
		await bot.Users.setData(user, 'location', location);
		res.json(locationView(location));
	}),
);

router.post(
	'/api/my/sidebar',
	locationRoute(async (user, req, res) => {
		const body = req.body ?? {};
		const sections = Array.isArray(body.sections) ? body.sections : null;
		const items = body.items && typeof body.items === 'object' && !Array.isArray(body.items) ? body.items : null;
		const validList = (list, max) => Array.isArray(list) && list.length <= max && list.every((i) => typeof i === 'string' && SIDEBAR_KEY.test(i));
		if (
			!sections ||
			!items ||
			!validList(sections, 20) ||
			Object.keys(items).length > 20 ||
			!Object.entries(items).every(([key, list]) => SIDEBAR_KEY.test(key) && validList(list, 40))
		) {
			res.status(400).json({ error: 'Invalid sidebar order.' });
			return;
		}

		const sidebar = { sections, items: items };
		await bot.Users.setData(user, 'dashboardSidebar', sidebar);
		res.json({ sidebar });
	}),
);

router.post(
	'/api/my/timezone',
	locationRoute(async (user, req, res) => {
		const retryAfter = checkRunLimits(req.ip ?? 'unknown', { Name: 'my-timezone', Cooldown: 1000 }, Date.now());
		if (retryAfter > 0) {
			res.status(429).json({ error: `Slow down, try again in ${retryAfter}s.` });
			return;
		}

		const input = String(req.body?.timezone ?? '').trim();
		const zone = input && input.length <= 20 ? detectTimezone(input) : null;
		if (!zone) {
			res.status(400).json({ error: "That's not a timezone I know. Try UTC+1 or CET." });
			return;
		} else if (isResultFailure(zone)) {
			res.status(400).json({ error: zone.reply });
			return;
		}

		const timezone = input.toUpperCase();
		await bot.Users.setData(user, 'timezone', timezone);
		res.json({ timezone });
	}),
);

module.exports = router;
