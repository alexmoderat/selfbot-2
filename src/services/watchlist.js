// Pro-Channel-Merkzettel verdaechtiger Chatter (Collection watchlist), aus sb-v2s watchlist-Funktionen - rein
// informativ, kein automatischer Ban. Twitchs eigenes "suspicious chatter"-Feature hat keine oeffentliche API.

const addToWatchlist = async (channel, login, reason, addedBy) => {
	await bot.DB.Watchlist.updateOne(
		{ channel: channel.id, login: login.toLowerCase() },
		{ $set: { reason, addedBy }, $setOnInsert: { added: new Date() } },
		{ upsert: true },
	);
};

/** true, wenn es einen Eintrag gab */
const removeFromWatchlist = async (channel, login) => (await bot.DB.Watchlist.deleteOne({ channel: channel.id, login: login.toLowerCase() })).deletedCount > 0;

/** [{ Login, Reason, Added_By, Added }] neueste zuerst */
const getWatchlist = async (channel) =>
	(await bot.DB.Watchlist.find({ channel: channel.id }).sort({ added: -1 }).lean()).map((i) => ({
		Login: i.login,
		Reason: i.reason,
		Added_By: i.addedBy,
		Added: i.added,
	}));

module.exports = { addToWatchlist, removeFromWatchlist, getWatchlist };
