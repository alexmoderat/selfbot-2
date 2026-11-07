const { commands } = require('../../../../clients/modules/commands.js');
const { fetchGeoLocationData, toUserLocation } = require('../../../command-utils.js');

module.exports = {
	name: 'location',
	aliases: [],
	parameter: 'arguments',
	description: `Sets/unsets your IRL location. If you add the keyword "private", it's going to be hidden. This location is used in commands such as weather, time, and others.`,
	flags: {
		pipe: false,
	},
	set: async (msg, ...args) => {
		let hidden = false;
		let visibilityType = 'public';

		const first = args.at(0);
		const last = args.at(-1);
		const resultArgs = [...args];

		if (first === 'public' || last === 'public') {
			hidden = false;
			visibilityType = 'public';
			if (first === 'public') {
				resultArgs.shift();
			} else {
				resultArgs.pop();
			}
		} else if (first === 'private' || last === 'private') {
			hidden = true;
			visibilityType = 'private';
			if (first === 'private') {
				resultArgs.shift();
			} else {
				resultArgs.pop();
			}
		}

		if (resultArgs.length === 0) {
			const location = await bot.Users.getData(msg.sender, 'location');
			if (location) {
				if (location.hidden === hidden) {
					return {
						success: false,
						text: `Your location is already ${visibilityType}!`,
					};
				} else {
					await bot.Users.setData(msg.sender, 'location', { ...location, hidden });
					return {
						success: true,
						text: `Your location has been set to ${visibilityType}.`,
					};
				}
			} else {
				return {
					success: false,
					text: 'No location provided!',
					cooldown: 2500,
				};
			}
		}

		// Supibot schickt hier versehentlich auch "private"/"public" mit in die Suche - resultArgs ist gemeint
		const query = resultArgs.join(' ');
		const result = await fetchGeoLocationData(query);
		if (!result.success) {
			return {
				success: false,
				text: 'No location found for given query!',
			};
		}

		await bot.Users.setData(msg.sender, 'location', toUserLocation(result, hidden));

		return {
			success: true,
			text: `Successfully set your ${visibilityType} location.`,
		};
	},
	unset: async (msg) => {
		const location = await bot.Users.getData(msg.sender, 'location');
		if (!location) {
			return {
				success: false,
				text: `You don't have a location set up, so there is nothing to unset!`,
			};
		}

		await bot.Users.setData(msg.sender, 'location', null);
		return {
			success: true,
			text: 'Your location has been unset successfully.',
		};
	},
};
