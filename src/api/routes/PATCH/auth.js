const express = require('express');
const { MAX_REMINDER_TEXT, editReminder, isReminderSource, listReminders, locationRoute } = require('../../auth.js');

const router = express.Router();

// ninou2, 07.11.2026: Reminder-Text auf der Seite anklicken und aendern
router.patch(
	'/api/my/reminders/:source/:id',
	locationRoute(async (user, req, res) => {
		const { source } = req.params;
		const id = Number(req.params.id);
		const body = req.body;
		const text = typeof body?.text === 'string' ? body.text.replace(/\s+/g, ' ').trim() : '';
		if (!isReminderSource(source) || !Number.isInteger(id) || id <= 0) {
			res.status(400).json({ error: 'Unknown reminder.' });
			return;
		} else if (!text) {
			res.status(400).json({ error: "The reminder text can't be empty." });
			return;
		} else if (text.length > MAX_REMINDER_TEXT) {
			res.status(400).json({ error: `The reminder text can be at most ${MAX_REMINDER_TEXT} characters.` });
			return;
		}

		if (!(await editReminder(user, source, id, text))) {
			res.status(404).json({ error: "That reminder is gone or isn't yours to edit." });
			return;
		}

		res.json({ reminders: await listReminders(user) });
	}),
);

module.exports = router;
