const SupiDate = require('../util/date.js');
const { isResultFailure } = require('../clients/modules/commands.js');
const { fetchGeoLocationData, fetchTimeData, formatTimezoneOffset } = require('../util/command-utils.js');
const { detectCountryTime, detectTimezone } = require('../util/timezones.js');

// Aus Supibots commands/time, Ort und Zeitzone ueber die Open-Meteo-Helfer statt Google
const zoneReply = (zone) => {
	if (isResultFailure(zone)) {
		return zone;
	}

	return {
		text:
			zone.name && zone.abbr
				? `TIMEZONEDETECTED ${zone.abbr} is ${zone.name}, which is UTC${zone.offset} and it is ${zone.date} there right now.`
				: `TIMEZONEDETECTED Time in UTC${zone.offset} is ${zone.date} right now.`,
	};
};

module.exports = {
	name: 'time',
	cooldown: 10000,
	description:
		'Fetches the current time and timezone for a given location, or a user, if they have set their location. Also takes a timezone ("utc", "cet", "utc+2") or a country ("uk", "Portugal").',
	usage: 'time [location | timezone | country | @user]',
	flags: ['block', 'mention', 'non-nullable', 'opt-out', 'pipe'],
	execute: async (client, msg) => {
		const args = [...msg.args];
		const zone = detectTimezone(...args);
		if (zone) {
			return zoneReply(zone);
		}

		const country = args.length > 0 ? detectCountryTime(args.join(' ')) : null;
		if (country) {
			if (country.times.length === 1) {
				const [{ offset, date }] = country.times;
				return { text: `${country.name} is currently on ${offset}, and it's ${date} there right now.` };
			}

			return {
				text: `${country.name} has ${country.times.length} time offsets right now: ${country.times.map((i) => `${i.offset} -> ${i.date}`).join(' // ')}`,
			};
		}

		let skipLocation = false;
		let coordinates = null;
		let place = args.join(' ');

		if (args.length === 0) {
			// ninou2, 03.11.2026: "!uts set UTC+1", "then when i type !time", "without adding anything". Hat Vorrang vor dem Ort
			const ownZone = detectTimezone((await bot.Users.getData(msg.sender, 'timezone')) ?? '');
			if (ownZone) {
				return zoneReply(ownZone);
			}

			const location = await bot.Users.getData(msg.sender, 'location');
			if (location) {
				coordinates = location.coordinates;
				skipLocation = location.hidden;
				place = location.formatted;
			} else {
				return {
					success: false,
					text: 'You must search for something first, or set your default location!',
					cooldown: 2500,
				};
			}
		} else if (args[0].startsWith('@')) {
			const targetUser = await bot.Users.get(args[0]);
			if (!targetUser) {
				return {
					success: false,
					text: 'That user does not exist!',
					cooldown: 2500,
				};
			} else if (targetUser.name === bot.Twitch.selfName) {
				const robotEmote = await msg.getBestAvailableEmote(['MrDestructoid'], '🤖');
				return {
					text: `My current time is ${SupiDate.now()} ${robotEmote}`,
				};
			}

			const targetZone = detectTimezone((await bot.Users.getData(targetUser, 'timezone')) ?? '');
			if (targetZone) {
				return zoneReply(targetZone);
			}

			const targetUserLocation = await bot.Users.getData(targetUser, 'location');
			if (!targetUserLocation) {
				const message =
					targetUser === msg.sender
						? `You have not set up your location! You can use "${msg.prefix}set location (location)" to set it up, or "${msg.prefix}set location private (location)" to make it private 🙂`
						: 'They have not set up their location!';

				return {
					success: false,
					text: message,
					cooldown: 2500,
				};
			} else {
				coordinates = targetUserLocation.coordinates;
				skipLocation = targetUserLocation.hidden;
				place = targetUserLocation.formatted;
			}
		}

		if (coordinates === null) {
			const geoData = await fetchGeoLocationData(place);
			if (!geoData.success) {
				const checkUserData = await bot.Users.get(args[0]);
				const checkLocation = await bot.Users.getData(checkUserData, 'location');

				if (checkUserData && !checkLocation) {
					return {
						success: false,
						text: `That place was not found! However, you probably meant to check that user's location - make sure to add the @ symbol before their name.`,
						cooldown: 5000,
					};
				}

				const sadEmote = await msg.getBestAvailableEmote(['peepoSadDank', 'FeelsBadMan'], '😟');
				return {
					success: false,
					text: `That place was not found! ${sadEmote}`,
				};
			} else {
				coordinates = geoData.location;
			}
		}

		const response = await fetchTimeData({ coordinates });
		const timeData = response.body;
		if (timeData.status === 'ZERO_RESULTS') {
			return {
				success: false,
				text: 'Target place is ambiguous - it contains more than one timezone!',
			};
		}

		const offset = formatTimezoneOffset(timeData);
		const time = new SupiDate();
		const totalOffset = timeData.rawOffset + timeData.dstOffset;
		time.setTimezoneOffset(totalOffset / 60);

		const locationDateTime = time.format('H:i (Y-m-d)');
		if (skipLocation) {
			return {
				text: bot.Utils.tag.trim`
					(location hidden) is using UTC${offset},
					and it's ${locationDateTime} there right now.
				 `,
			};
		} else {
			return {
				text: bot.Utils.tag.trim`
					${place} is currently observing ${timeData.timeZoneName}, 
					which is UTC${offset},
					and it's ${locationDateTime} there right now.
				 `,
			};
		}
	},
	dynamicDescription: (prefix) => [
		'For a provided location, returns the current time, timezone and date it is observing.',
		`Supports custom locations of users - this can be set with the <a href="/bot/command/detail/set"><code>${prefix}set location</code></a> command.`,
		'',

		`<code>${prefix}time (location)</code>`,
		"Shows the location's time data.",
		'',

		`<code>${prefix}time (timezone name)</code>`,
		`<code>${prefix}time (timezone offset)</code>`,
		`<code>${prefix}time NZDT</code>`,
		`<code>${prefix}time GMT-5</code>`,
		`<code>${prefix}time UTC+4:45</code>`,
		'Shows the time data for a provided timezone.',
		'',

		`<code>${prefix}time</code>`,
		`If you have set your custom location with the <code>${prefix}set</code> command (see above), this command will return your location's time data.`,
		'',

		`<code>${prefix}time @(user)</code>`,
		`Similar to your own custom location, but for a different user. Make sure to include the <code>@</code> symbol!`,
		'',
	],
};
