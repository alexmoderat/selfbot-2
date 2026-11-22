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
