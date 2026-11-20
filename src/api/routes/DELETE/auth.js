const express = require('express');
const { isReminderSource, listReminders, removeReminder, locationRoute, locationView } = require('../../auth.js');

const router = express.Router();

router.delete(
	'/api/my/location',
	locationRoute(async (user, _req, res) => {
		await bot.Users.setData(user, 'location', null);
		res.json(locationView(null));
	}),
);

router.delete(
	'/api/my/sidebar',
	locationRoute(async (user, _req, res) => {
		await bot.Users.setData(user, 'dashboardSidebar', null);
		res.json({ sidebar: null });
	}),
);

router.delete(
	'/api/my/reminders/:source/:id',
	locationRoute(async (user, req, res) => {
		const { source } = req.params;
		const id = Number(req.params.id);
		if (!isReminderSource(source) || !Number.isInteger(id) || id <= 0) {
			res.status(400).json({ error: 'Unknown reminder.' });
			return;
		}

		await removeReminder(user, source, id);
		res.json({ reminders: await listReminders(user) });
	}),
);

router.delete(
	'/api/my/timezone',
	locationRoute(async (user, _req, res) => {
		await bot.Users.setData(user, 'timezone', null);
		res.json({ timezone: null });
	}),
);

module.exports = router;
