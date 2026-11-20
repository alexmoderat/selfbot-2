const { getConfig, filterByConfig } = require('./config.js');

// Welche von Donts Commands (src/commands/*.js) mitlaufen: config.json > dont.commands, wie bei unseren Modulen
// (disableAll > whitelist > blacklist). Standard: keine. Eingehaengt in src/clients/modules/commands.js.

/** @param {string} name Dateiname ohne .js */
const isEnabled = (name, config = getConfig()) => filterByConfig([name], (i) => i, config.dont.commands).length > 0;

module.exports = { isEnabled };
