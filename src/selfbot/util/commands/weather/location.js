const { fetchGeoLocationData } = require('../../command-utils.js');

const getGeoCacheKey = (query) => `weather-location-cache-${query.toLowerCase().trim()}`;

const getUserLocation = async (possibleUsername) => {
	const userData = await bot.Users.get(possibleUsername);
	if (!userData) {
		return {
			success: false,
			reason: 'no-user',
		};
	}

	const location = await bot.Users.getData(userData, 'location');
	if (!location) {
		return {
			success: false,
			reason: 'no-location',
			userData,
		};
	}

	return {
		success: true,
		location,
		userData,
	};
};

const getWeatherLocation = async (msg, args) => {
	let origin;
	let hidden = false;
	let coords;
	let address;

	if (args.length === 0) {
		const location = await bot.Users.getData(msg.sender, 'location');
		if (!location) {
			return {
				command: {
					success: false,
					text: `No place provided, and you don't have a default location set! You can use ${msg.prefix}set location (location) to set it, or add "private" to make it private 🙂`,
				},
			};
		}

		origin = 'self';
		hidden = location.hidden;
		coords = location.coordinates;
		address = location.formatted;
	} else if (args[0].startsWith('@')) {
		const result = await getUserLocation(args[0]);
		if (!result.success) {
			if (result.reason === 'no-user') {
				return {
					command: {
						success: false,
						text: 'Invalid user provided!',
					},
				};
			} else {
				const who = result.userData.id === msg.sender.id ? 'You' : 'That user';
				return {
					command: {
						success: false,
						text: `${who} did not set their location!`,
					},
				};
			}
		}

		const { location, userData } = result;
		origin = userData.id === msg.sender.id ? 'self' : 'user';
		coords = location.coordinates;
		hidden = location.hidden;
		address = location.formatted;
	} else {
		const location = args.join(' ');
		const cacheKey = getGeoCacheKey(location);

		let geoData = await bot.Cache.getJSON(cacheKey);
		if (!geoData) {
			const data = await fetchGeoLocationData(location);
			if (!data.success) {
				// only happens on zero results, API failure causes a request error
				geoData = { empty: true };
			} else {
				geoData = {
					empty: false,
					formattedAddress: data.formatted,
					coords: data.location,
				};
			}

			await bot.Cache.setJSON(cacheKey, geoData, 7 * 864e5);
		}

		if (geoData.empty) {
			// Check if the not-found location is actually someone's username - possibly as a user error
			const result = await getUserLocation(location);
			if (!result.success) {
				const emote = await msg.getBestAvailableEmote(['peepoSadDank', 'PepeHands', 'FeelsBadMan'], '🙁');
				return {
					command: {
						success: false,
						text: `That place was not found! ${emote}`,
					},
				};
			}

			origin = result.userData.id === msg.sender.id ? 'self' : 'user';
			address = result.location.formatted;
			coords = result.location.coordinates;
			hidden = result.location.hidden;
		} else {
			origin = 'public';
			address = geoData.formattedAddress;
			coords = geoData.coords;
		}
	}

	return {
		location: {
			origin,
			coords,
			hidden,
			address: hidden ? '(location hidden)' : address,
		},
	};
};

module.exports = { getWeatherLocation };
