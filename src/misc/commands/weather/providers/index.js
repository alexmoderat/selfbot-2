const { Owm3WeatherProvider, Owm4WeatherProvider } = require('./owm.js');
const { OpenMeteoProvider } = require('./open-meteo.js');

const openMeteoWeatherProvider = new OpenMeteoProvider();

const weatherProviders = {
	owm3: new Owm3WeatherProvider(),
	owm4: new Owm4WeatherProvider(),
	'open-meteo': openMeteoWeatherProvider,
};

module.exports = { openMeteoWeatherProvider, weatherProviders };
