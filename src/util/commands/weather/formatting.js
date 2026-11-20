const SupiDate = require('../../date.js');

const WEATHER_FORMAT_KEYS = [
	'cloudCover',
	'humidity',
	'icon',
	'place',
	'precipitation',
	'pressure',
	'sun',
	'temperature',
	'apparentTemperature',
	'windGusts',
	'windSpeed',
];

const isWeatherFormatKey = (input) => WEATHER_FORMAT_KEYS.includes(input);

const WIND_DIRECTIONS = ['NNE', 'NE', 'ENE', 'E', 'ESE', 'SE', 'SSE', 'S', 'SSW', 'SW', 'WSW', 'W', 'WNW', 'NW', 'NNW'];
const windDirectionInterval = 22.5;
const getWindDirection = (degrees) => {
	degrees %= 360;

	const base = 11.25;
	if (degrees < base || degrees >= 360 - base) {
		return 'N';
	}

	// It is guaranteed that the value (0-359) is going to fall between the 15 different wind directions, so always `string`
	const index = Math.trunc((degrees - base) / windDirectionInterval);
	return WIND_DIRECTIONS.at(index);
};

const formatTemperature = (report, type) => {
	if (type === 'real') {
		return report.kind === 'daily' ? `${report.temperature.min}°C to ${report.temperature.max}°C.` : `${report.temperature.actual}°C.`;
	} else {
		return report.kind !== 'daily' && typeof report.temperature.feelsLike === 'number' ? `Feels like ${report.temperature.feelsLike}°C.` : '';
	}
};
const formatCloudCover = (report) => (typeof report.cloudCover === 'number' ? `Cloud cover: ${report.cloudCover}%.` : '');
const formatHumidity = (report) => (typeof report.humidity === 'number' ? `Humidity: ${report.humidity}%.` : '');
const formatPressure = (report) => (typeof report.pressure === 'number' ? `Air pressure: ${report.pressure} hPa.` : '');
const formatWindSpeed = (report) => {
	const speed = report.wind?.speed;
	if (typeof speed !== 'number') {
		return '';
	}
	if (!speed) {
		return 'No wind.';
	}

	const direction = report.wind?.direction;
	const directionText = typeof direction === 'number' ? `${getWindDirection(direction)} wind` : 'Wind';
	return `${directionText} speed: ${speed} m/s.`;
};
const formatWindGusts = (report) => {
	const gust = report.wind?.gust;
	if (typeof gust !== 'number') {
		return '';
	}
	if (!gust) {
		return 'No wind gusts.';
	}

	return `Wind gusts: ${gust} m/s.`;
};
const formatPrecipitation = (report) => {
	const precipitation = report.precipitation;
	if (!precipitation) {
		return 'No precipitation expected.';
	}

	const { rain, snow, probability, timeUntil } = precipitation;
	if (report.kind === 'current') {
		if (rain && snow) {
			return `It is currently raining (${rain} mm/h) and snowing (${snow} mm/h).`;
		} else if (rain) {
			return `It is currently raining, ${rain} mm/h.`;
		} else if (snow) {
			return `It is currently snowing, ${snow} mm/h.`;
		} else if (timeUntil) {
			return timeUntil;
		}

		return 'No precipitation right now.';
	}

	if (!probability) {
		return 'No precipitation expected.';
	}

	const percent = `${bot.Utils.round(probability * 100, 0)}%`;
	if (rain && snow) {
		return `${percent} chance of combined rain (${rain} mm/h) and snow (${snow} mm/h).`;
	} else if (rain) {
		return `${percent} chance of ${rain} mm/h rain.`;
	} else if (snow) {
		return `${percent} chance of ${snow} mm/h snow.`;
	} else {
		return `${percent} chance of precipitation.`;
	}
};
const formatSun = (report, meta) => {
	if (meta.hiddenLocation || report.kind !== 'current' || !report.sun) {
		return '';
	}

	const nowSeconds = SupiDate.now() / 1000;
	const { rise, set } = report.sun;
	if (rise && nowSeconds < rise) {
		return `Sun rises ${bot.Utils.timeDelta(rise * 1000)}.`;
	} else if (set && nowSeconds < set) {
		return `Sun sets ${bot.Utils.timeDelta(set * 1000)}.`;
	}

	return '';
};
const formatReportTime = (report) => {
	if (report.kind === 'current') {
		const delta = bot.Utils.timeDelta(report.timestamp);
		return `(${delta})`;
	}
	if (report.kind === 'hourly') {
		return `(${report.time} local time)`;
	}

	return `(${report.date} local date)`;
};

const createWeatherFormatObject = (report, meta) => ({
	place: meta.hiddenLocation ? '(location hidden)' : meta.place,
	icon: report.condition.icon ?? '',
	temperature: formatTemperature(report, 'real'),
	apparentTemperature: formatTemperature(report, 'apparent'),
	cloudCover: formatCloudCover(report),
	humidity: formatHumidity(report),
	pressure: formatPressure(report),
	windSpeed: formatWindSpeed(report),
	windGusts: formatWindGusts(report),
	precipitation: formatPrecipitation(report),
	sun: formatSun(report, meta),
});

const formatWeatherReport = (report, options) => {
	const obj = createWeatherFormatObject(report, options);
	if (options.customFormat) {
		const keys = typeof options.customFormat === 'string' ? options.customFormat.split(',').filter(Boolean) : options.customFormat;

		const reply = [];
		for (const key of keys) {
			if (!isWeatherFormatKey(key)) {
				reply.push(key);
				continue;
			}

			reply.push(obj[key]);
		}

		return {
			formatted: reply.filter(Boolean).join(' '),
		};
	}

	return {
		formatted: bot.Utils.tag.trim`
			${obj.place} ${formatReportTime(report)}:
			${obj.icon}
			${obj.temperature} ${obj.apparentTemperature}
			${obj.cloudCover}
			${obj.windSpeed} ${obj.windGusts}
			${obj.humidity}
			${obj.precipitation}
			${obj.pressure}
			${obj.sun}
		`,
	};
};

module.exports = { WEATHER_FORMAT_KEYS, formatWeatherReport };
