// Timer pro Channel (Collection channelTimer): Speicherung fuer commands/timer, Versand in crons/timers.
// Datensaetze in der alten Form ({ ID, Channel, Message, Interval_Seconds, Online_Only, Enabled, Last_Sent }).

const toRow = (doc) => {
	const row = bot.DB.toRow('ChannelTimer', doc);
	return { ...row, Last_Sent: row.Last_Sent ? new Date(row.Last_Sent).valueOf() : null };
};

const list = async (channel) => (await bot.DB.ChannelTimer.find({ channel: channel.id }).sort({ _id: 1 }).lean()).map(toRow);

const listEnabled = async () => (await bot.DB.ChannelTimer.find({ enabled: true }).lean()).map(toRow);

/** @returns {Promise<number>} ID des neuen Timers */
const add = async (channel, message, intervalSeconds, onlineOnly, createdBy) => {
	const doc = await bot.DB.createWithId('ChannelTimer', {
		channel: channel.id,
		message,
		intervalSeconds,
		onlineOnly,
		enabled: true,
		createdBy,
		created: new Date(),
	});
	return doc._id;
};

/** values mit Spaltennamen ({ Enabled: false, Message: ... }) */
const update = async (timer, values) => {
	await bot.DB.ChannelTimer.updateOne({ _id: timer.ID }, { $set: bot.DB.fromRow('ChannelTimer', values) });
};

const remove = async (timer) => {
	await bot.DB.ChannelTimer.deleteOne({ _id: timer.ID });
};

const markSent = async (timer) => {
	await bot.DB.ChannelTimer.updateOne({ _id: Number(timer.ID) }, { $set: { lastSent: new Date() } });
};

module.exports = { list, listEnabled, add, update, remove, markSent };
