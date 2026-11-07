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

		const lastAFK = await core.Query.getRecordset((rs) =>
			rs // TODO(port)
				.select('*')
				.from('selfbot_core', 'AFK')
				.where('User_Alias = %n', msg.sender.id)
				.orderBy('ID DESC')
				.limit(1)
				.single(),
		);

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

		const oldAFK = await core.Query.getRow('selfbot_core', 'AFK'); // TODO(port)
		await oldAFK.load(lastAFK.ID);

		oldAFK.setValues({
			Interrupted_ID: newAFK.ID,
			Active: false,
		});

		await oldAFK.save({ skipLoad: true });

		// Supibot macht den Cooldown hier global (alle Channels); das Cooldown-Objekt gibt es hier noch nicht
		return {
			text: 'Your AFK status has been resumed.',
		};
	},
};
