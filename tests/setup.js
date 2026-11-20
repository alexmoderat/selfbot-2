// Vor allen Tests geladen (node --require): Donts util/twitch/connections.js verbindet beim Laden mit Twitch und
// liest config.json. In Tests ersetzt ein unverbundener ChatClient die Datei.
const { ChatClient } = require('@kararty/dank-twitch-irc');

const file = require.resolve('../src/util/twitch/connections.js');
require.cache[file] = { id: file, filename: file, loaded: true, children: [], paths: [], exports: { client: new ChatClient({ username: 'test' }) } };
