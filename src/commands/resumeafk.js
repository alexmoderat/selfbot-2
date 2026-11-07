const SupiDate = require('../misc/date.js');

const RESUME_AFK_THRESHOLD_SEC = 120;

module.exports = {
	name: 'resumeafk',
	aliases: ['rafk', 'cafk', 'continueafk'],
	cooldown: 60_000,
	description:
		'Resumes your AFK status, if used shortly after coming back from an AFK. The time period is global, not just in the channel you came back from AFK in.',
	usage: 'resumeafk',
	flags: ['mention', 'pipe'],
	execute: async (client, msg) => {
		if (msg.privateMessage) {
			return {
				success: false,
				text: 'Resuming your AFK status is only permitted outside of private messages!',
			};
		}

		const doc = await bot.DB.AFK.findOne({ userId: msg.sender.id }).sort({ _id: -1 }).lean();
		// Alte Form wie bisher (Ended als SupiDate fuer addSeconds)
		const lastAFK = doc
			? {
					ID: doc._id,
					Text: doc.text,
					Started: doc.started,
					Status: doc.status,
					Interrupted_ID: doc.interruptedId,
					Ended: doc.ended ? new SupiDate(doc.ended) : null,
				}
			: null;

		if (!lastAFK) {
			return {
				success: false,
				text: 'You cannot resume your AFK status, because you have never went AFK with me before!',
			};
		} else if (!lastAFK.Ended) {
			return {
				text: 'You were AFK until this moment... Try again?',
				cooldown: 10_000,
			};
		}

		const now = new SupiDate().valueOf();
		const threshold = lastAFK.Ended.addSeconds(RESUME_AFK_THRESHOLD_SEC).valueOf();
		if (threshold <= now) {
			return {
				text: 'You cannot resume your AFK status, because it ended too long ago!',
				cooldown: 10_000,
			};
		} else if (lastAFK.Interrupted_ID) {
			return {
				success: false,
				text: 'You have somehow already resumed this AFK status!',
				cooldown: 10_000,
			};
		}

		const newAFK = await bot.AFK.set(msg.sender, {
			User_Alias: msg.sender.id,
			Text: lastAFK.Text,
			Started: lastAFK.Started,
			Status: lastAFK.Status,
		});

		await bot.DB.AFK.updateOne({ _id: lastAFK.ID }, { $set: { interruptedId: newAFK.ID, active: false } });

		// Supibot macht den Cooldown hier global (alle Channels); das Cooldown-Objekt gibt es hier noch nicht
		return {
			text: 'Your AFK status has been resumed.',
		};
	},
};
