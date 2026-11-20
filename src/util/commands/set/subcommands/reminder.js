module.exports = {
	name: 'reminder',
	aliases: ['remind', 'reminders'],
	parameter: 'ID',
	description: 'Unsets an active reminder either set by you, or for you. You can use the <code>from:(user)</code> parameter to quickly unset all timed reminders set for you by a given user.',
	flags: {
		pipe: true,
	},
	getLastID: async (msg) => (await bot.DB.Reminder.findOne({ userFrom: msg.sender.id }, { _id: 1 }).sort({ _id: -1 }).lean())?._id,
	unset: async (msg, ID) => {
		const row = await bot.DB.getRow('Reminder');
		await row.load(ID, true);

		if (!row.loaded) {
			const historyRow = await bot.DB.getRow('ReminderHistory');
			await historyRow.load(ID, true);
			return {
				success: false,
				text: historyRow.loaded ? 'That reminder is already deactivated!' : 'There is no reminder with such ID!',
			};
		} else if (row.values.User_From !== msg.sender.id && row.values.User_To !== msg.sender.id) {
			return {
				success: false,
				text: 'That reminder was not created by you or set for you!',
			};
		} else if (msg.channelData?.id && !row.values.Schedule && row.values.User_To === msg.sender.id) {
			return {
				success: false,
				text: 'Good job, trying to unset a reminder that just fired PepeLaugh',
			};
		}

		const reminder = bot.Reminders.get(ID);
		if (!reminder) {
			return {
				success: false,
				text: `Can't unset this reminder - it exists in the database, but is not loaded! (ID ${ID})`,
			};
		}

		await reminder.deactivate(true, true);
		return {
			text: `Reminder ID ${ID} unset successfully.`,
		};
	},
	userSpecificUnset: async (msg, from) => {
		const authorUserData = await bot.Users.get(from);
		if (!authorUserData) {
			return {
				success: false,
				text: `No such user exists!`,
			};
		}

		const reminderIDs = (await bot.DB.Reminder.find({ schedule: { $ne: null }, userFrom: authorUserData.id, userTo: msg.sender.id }, { _id: 1 }).lean()).map((i) => i._id);

		if (reminderIDs.length === 0) {
			return {
				success: false,
				text: `You have no active timed reminders pending from that user!`,
			};
		}

		const promises = [];
		for (const reminderID of reminderIDs) {
			const reminder = bot.Reminders.get(reminderID);
			if (reminder) {
				promises.push(reminder.deactivate(true, true));
			}
		}

		await Promise.all(promises);
		return {
			text: `Successfully unset ${promises.length} timed reminders from that user.`,
		};
	},
};
