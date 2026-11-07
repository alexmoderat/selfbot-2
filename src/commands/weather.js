const { isHttpError: isGotRequestError } = require('../token/http.js');
const { isResultFailure } = require('../clients/modules/commands.js');
const { getWeatherLocation } = require('../misc/commands/weather/location.js');
const { weatherProviders } = require('../misc/commands/weather/providers/index.js');
const { formatWeatherReport } = require('../misc/commands/weather/formatting.js');
const { getDefaultProvider, isValidWeatherProviderName } = require('../misc/commands/weather/providers/weather-template.js');

const ALLOWED_FORMAT_TYPES = ['cloudCover', 'humidity', 'icon', 'place', 'precipitation', 'pressure', 'sun', 'temperature', 'windGusts', 'windSpeed'];
// Unwetterwarnungen und OWM-Vorhersagen brauchen OpenWeatherMaps "One Call 3.0/4.0"-Abo;
// ohne Abo antwortet OWM mit 401 - statt "Third party service failed" eine klare Antwort.
const withOwmSubscription = async (callback) => {
	try {
		return await callback();
	} catch (e) {
		if (isGotRequestError(e) && (e.response?.statusCode === 401 || e.response?.statusCode === 403)) {
			return {
				success: false,
				text: 'This needs an OpenWeatherMap One Call subscription, which is not set up for this bot!',
			};
		}

		throw e;
	}
};

const determineReportType = (args) => {
	for (let i = 0; i < args.length; i++) {
		const arg = args[i];
		const hourMatch = arg.match(/^hour\+(\d+)/);
		if (hourMatch) {
			return {
				type: 'hourly',
				offset: Number(hourMatch[1]),
				args: [...args.slice(0, i), ...args.slice(i + 1)],
			};
		}

		const dayMatch = arg.match(/^day\+(\d+)/);
		if (dayMatch) {
			return {
				type: 'daily',
				offset: Number(dayMatch[1]),
				args: [...args.slice(0, i), ...args.slice(i + 1)],
			};
		}
	}

	return {
		type: 'current',
		offset: null,
		args,
	};
};

module.exports = {
	name: 'weather',
	// "w" aus sb-v2 behalten, dort war es der gewohnte Kurzname
	aliases: ['w'],
	cooldown: 10000,
	usage: 'weather [place | @user] [hour+X | day+X]',
	description:
		'Fetches the current weather in a given location. You can specify parameters to check the forecast, or mention a user to get their location, if they set it up. Check all possibilities in extended help.',
	flags: ['mention', 'non-nullable', 'pipe'],
	params: [
		{ name: 'alerts', type: 'boolean' },
		{ name: 'format', type: 'string' },
		{ name: 'pollution', type: 'boolean' },
		{ name: 'provider', type: 'string' },
	],
	execute: async (client, msg) => {
		let args = [...msg.args];
		const reportData = determineReportType(args);
		args = reportData.args;

		const locationResult = await getWeatherLocation(msg, args);
		if ('command' in locationResult) {
			return locationResult.command;
		}

		const { coords, address, hidden, origin } = locationResult.location;
		if (msg.params.pollution) {
			const pollution = await weatherProviders.owm3.fetchPollution(coords);
			if (isResultFailure(pollution)) {
				return pollution;
			}

			return {
				success: true,
				text: bot.Utils.tag.trim`
					${address} current pollution index: ${pollution.index} ${pollution.icon}
					Particles: ${pollution.components}.				
				`,
			};
		}
		if (msg.params.alerts) {
			const alerts = await withOwmSubscription(() => weatherProviders.owm3.fetchAlerts(coords));
			if (isResultFailure(alerts)) {
				return alerts;
			}
			if (alerts.empty) {
				return {
					success: true,
					text: `Weather alert summary for ${address} - no alerts.`,
				};
			}

			if (hidden) {
				if (origin === 'self') {
					await bot.Twitch.pm(`Your location's weather alerts: ${alerts.link}`, msg.sender);
					return {
						success: true,
						text: bot.Utils.tag.trim`
							Weather alert summary for your hidden location: ${alerts.amount} alerts.
							I sent you a private message with the link to the full description.
						`,
					};
				} else {
					return {
						success: true,
						text: `Weather alert summary for their hidden location: ${alerts.amount} alerts.`,
					};
				}
			} else {
				return {
					success: true,
					text: `Weather alert summary for ${address} - ${alerts.amount} alerts - full info: ${alerts.link}`,
				};
			}
		}

		const providerName = msg.params.provider ?? getDefaultProvider();
		if (!isValidWeatherProviderName(providerName)) {
			return {
				success: false,
				text: 'Invalid weather provider provided!',
			};
		}

		const provider = weatherProviders[providerName];
		const data = await withOwmSubscription(async () => {
			if (reportData.type === 'current') {
				return await provider.getCurrent(coords);
			} else if (reportData.type === 'hourly') {
				return await provider.getHourly(coords, reportData.offset);
			} else {
				return await provider.getDaily(coords, reportData.offset);
			}
		});

		if (isResultFailure(data)) {
			return data;
		}

		const { formatted } = formatWeatherReport(data, {
			place: address,
			hiddenLocation: hidden,
			customFormat: msg.params.format,
		});

		return {
			success: true,
			text: formatted,
		};
	},
	dynamicDescription: (prefix) => [
		'Checks for current weather, or for hourly/daily forecast in a given location.',
		'If you, or a given user have set their location with the <code>set</code> command, this command can use that location directly.',
		`Check the <a href="/bot/command/detail/set">${prefix}set location</a> command's detailed help on how to set it, and make it private if needed.`,
		'',

		'<h5>Current weather</h5>',

		`<code>${prefix}weather (place)</code>`,
		`<code>${prefix}weather Berlin</code>`,
		`<code>${prefix}weather Norway, Michigan, US</code>`,
		'Posts the current weather in a given location.',
		'',

		'<h5>Weather forecast</h5>',

		`<code>${prefix}weather (place) <b>hour+X</b></code>`,
		'Posts the weather forecast in X hour(s) - accepts numbers from 0 (summary for the current hour) to 72 (in 3 days).',
		'',

		`<code>${prefix}weather (place) <b>day+X</b></code>`,
		'Posts the weather forecast in X day(s) - accepts numbers from 0 (summary for today) through 13 (in ~2 weeks).',
		'',

		'<h5>Pollution and alerts</h5>',

		`<code>${prefix}weather (place) alerts:true</code>`,
		'Posts a summary of all weather alerts for the provided location - for the next 7 days.',
		'',

		`<code>${prefix}weather (place) pollution:true</code>`,
		'Posts a summary of the current pollution for the provided location.',
		'',

		'<h5>Weather for your own location</h5>',

		`<code>${prefix}weather</code>`,
		`<code>${prefix}weather alerts:true</code>`,
		`<code>${prefix}weather pollution:true</code>`,
		"If you set your own weather location, using no extra text like this will show your location's weather.",
		'Works the same for the hourly, daily, alerts, pollution and format usages.',
		'',

		"<h5>Weather for others' locations</h5>",

		`<code>${prefix}weather User</code>`,
		`<code>${prefix}weather @User</code>`,
		`<code>${prefix}weather @User <b>(hour+X/day+X)</b></code>`,
		'If that user has set their own weather location, show its weather.',
		"The <code>@</code> symbol is not mandatory, but should be used if the user's name is similar or even identical to a real location.",
		'',

		'<h5>Weather providers</h5>',
		`<code>${prefix}weather provider:(provider)</code>`,
		`<code>${prefix}weather provider:owm3</code>`,
		`<code>${prefix}weather provider:owm4</code>`,
		`<code>${prefix}weather provider:open-meteo</code>`,
		"If you are unhappy with the default weather provider's accuracy, you can choose others specifically.",
		`The default provider is <a href="//open-meteo.com">Open-Meteo.com</a>, but you can also use <a href="//openweathermap.org">OpenWeatherMap</a>'s 3.0 or 4.0 forecast APIs.`,
		'Keep in mind that OpenWeatherMap has different ranges on hourly (0-47) and daily (0-7) forecasts, usually lower than Open-Meteo.',
		'',

		'<h5>Custom weather format</h5>',

		`<code>${prefix}weather (place) format:(custom format)</code>`,
		`<code>${prefix}weather (place) format:temperature</code>`,
		`<code>${prefix}weather (place) format:temperature,humidity,pressure</code>`,
		`<code>${prefix}weather (place) format:temperature,humidity,pressure hour+X</code>`,
		`<code>${prefix}weather format:temperature,humidity,pressure hour+X</code>`,
		'Lets you choose specific weather elements to show in the result.',
		'Works for all above forecasts (not alerts and pollution)',
		`Supported elements: <code>${ALLOWED_FORMAT_TYPES.join(', ')}</code>`,
	],
};
