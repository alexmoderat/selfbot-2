const weatherProviders = ['owm3', 'owm4', 'open-meteo'];

const getDefaultProvider = () => 'open-meteo';

const isValidWeatherProviderName = (input) => weatherProviders.includes(input);

module.exports = { getDefaultProvider, isValidWeatherProviderName };
