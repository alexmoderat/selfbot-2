module.exports = {
	name: 'suggestion',
	aliases: ['suggest', 'suggestions'],
	parameter: 'ID',
	description: 'Marks an active suggestion created by you to be "Dismissed by author", therefore removing it from the list of active suggestions.',
	flags: {
		pipe: false, // suggest itself isn't pipe-able
	},
	getLastID: async (msg) => (await bot.DB.Suggestion.findOne({ userAlias: msg.sender.id }, { _id: 1 }).sort({ _id: -1 }).lean())?._id,
	unset: async (msg, ID) => {
		const row = await bot.DB.getRow('Suggestion');
		await row.load(ID, true);
		if (!row.loaded) {
			return {
				success: false,
				text: 'ID does not exist!',
			};
		}

		if (row.values.User_Alias !== msg.sender.id) {
			return {
				success: false,
				text: 'That suggestion was not created by you!',
			};
		} else if (!row.values.Status || row.values.Status === 'New') {
			row.setValues({
				Status: 'Dismissed by author',
				Priority: null,
				Category: row.values.Category ?? 'Void',
			});

			await row.save({ skipLoad: true });
			return {
				text: `Suggestion ID ${ID} has been set as "Dismissed by author".`,
			};
		} else {
			return {
				success: false,
				text: "You cannot unset a suggestion if it's already been processed!",
			};
		}
	},
};
