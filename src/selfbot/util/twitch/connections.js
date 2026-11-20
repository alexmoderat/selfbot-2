// Der eine ChatClient des Bots stammt von DontAddThisBot (src/util/twitch/connections.js, verbindet beim Laden).
// Hier nur der Zugang fuer unseren Baum. Das Passwort ist ein fester User-Token (TWITCH_USER_TOKEN in .env), eine
// Erneuerung entfaellt.
const { client } = require('../../../util/twitch/connections.js');

module.exports = { client };
