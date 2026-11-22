# Struktur

Ein Baum unter `src/`, kein Fremdcode mehr daneben.

```
src/main.js        Einstieg: legt das globale `bot` an, startet DB, Channels, Commands, Module, Crons, Web/API
src/config.js      config.json laden und pruefen
src/commands/      ein Command pro Datei
src/clients/       twitch.js, events/ (ein Handler pro IRC-Event), modules/ (chat/, crons/, handler, cooldown, timers)
src/api/           Dashboard, OAuth, /v1, interne API
src/database/      Postgres-ORM (orm/, models/), Redis
src/token/         Helix, GQL, 7TV, Fingerprint-Client
src/util/          Dienste (channels, users, filter, afk, reminders ...) und Helfer
src/misc/          Logger, Zeitformate, Regex
```

## Command-Form (wie song-bot)

Jede Datei in `src/commands/` exportiert `command`; weitere Exporte (Hilfsfunktionen fuer Tests) stehen daneben.

```js
const command = {
	name: 'skip',
	aliases: ['next'],
	description: '...',
	access: { global: 1 }, // global: 0 jeder, 1 Bot-Administrator; channel: 0 jeder, 2 Mod, 3 Broadcaster
	cooldown: { user: 5 }, // Sekunden
	flags: ['pipe'], // Zusatz: pipe, mention, no-prefix, confirm, opt-out, ...
	execute: async ({ client, message, config, isMod, isBroadcaster, isAdmin, channel }) => {
		return 'Skipped.'; // String = Antwort; { success: false, text, cooldown, ... } fuer Sonderfaelle
	},
};

module.exports = { command };
```

`commandHandler.js` (`normalize`) macht daraus intern Flags (`owner`/`mod`) und `cooldown` in ms; Handler, Filter und API lesen weiter die interne Form.
