# Konzept: DontAddThisBot als Basis, selfbot-next daraufgesetzt

Entscheidung von alexmoderat: Donts Code ist die wortwoertliche Grundlage, unsere Funktionen kommen als zusaetzliche
Dateien dazu. Dieses Dokument legt fest, wie beides nebeneinander laeuft. Die Liste der Abweichungen steht in
[dont-abweichungen.md](dont-abweichungen.md).

Dont-Stand: `kattah7/DontAddThisBot` Commit `c8d7308` (2023-07-31, ISC-Lizenz, Autor Kattah).

## 1. Ordnerlayout

```
src/                    <- Donts Baum (main.js, clients/, util/, api/, database/, misc/, token/, commands/)
src/selfbot/            <- unser bisheriger Baum, unveraendert aufgebaut (git mv, Verlauf bleibt)
    commands/ (127)  clients/modules/chat/ (38)  clients/modules/crons/ (20)  util/  api/  database/orm/ ...
```

Unser Baum behaelt seine internen relativen Pfade (`../util/...`), deshalb aendert sich in unseren ~600 Dateien
fast nichts. Namensgleiche Dateien (`main.js`, `handler.js`, `cooldown.js`, `commands/ping.js` ...) liegen an
verschiedenen Orten und stoeren sich nicht. Donts Dateien stehen an Donts Pfaden, ohne Umbenennung.

## 2. Zwei Pipelines auf einem IRC-Client

Donts `connections.js` erzeugt den einen `ChatClient`. Beide Welten haengen sich daran:

- **Donts Pipeline** (`clients/events/*`, `clients/modules/handler.js`, `src/commands/*`) laeuft unveraendert. Sie
  bedient nur Donts Commands und nur die, die `dont.commands` in der config freigibt.
- **Unsere Pipeline** (`src/selfbot/clients/...`) registriert ihre eigenen Listener am selben Client
  (`client.on('PRIVMSG', ...)` darf mehrfach stehen) und bedient unsere Commands, Chat-Module, Crons, AFK, Reminder,
  Filter, Banphrasen, Dashboard.

Donts Handler ignoriert unbekannte Commands (`if (!command && !aliases.get(cmd)) return;`), unser Handler ebenso. Damit
braucht weder `handler.js` noch `PRIVMSG.js` einen Einhaengepunkt. Gleiche Command-Namen (`ping`, `join`, `optout`,
`restart`, `setprefix`, `pyramid`, `suggest`) beantwortet nur eine Seite: Donts Commands sind standardmaessig aus
(`dont.commands.disableAll: true`), es antwortet also unser `ping`.

## 3. Datenhaltung: nichts teilt sich einen Namen

| Was                                      | Wo                                                                 |
| ---------------------------------------- | ------------------------------------------------------------------ |
| Donts SQL-Tabellen (`users`, `commands`, `channels`, `channel_settings`, `user_commands_settings`, `stv_ids`, `pubsub_events`, `logout_token`, `stv_roles`) | eigene Postgres-DB `dontaddthisbot` (Donts `postgres.js` erzwingt den Namen), eigene Rolle |
| Unsere Tabellen (`channels`, `users` mit `_id`/`name`/`mode`/`data`, ...) | Postgres `selfbot_next`, ORM `src/selfbot/database/orm/` |
| `bot.SQL`                                | Donts `pg`-Pool auf `dontaddthisbot` (unser Pool heisst `bot.PG`)    |
| `bot.DB`                                 | Kompatibilitaetsschicht `src/database/db.js` (Mongoose-Aufrufe wie `bot.DB.users.findOne({id}).exec()`) plus unsere Modelle (`bot.DB.User`, `bot.DB.Reminder`, ...). Gross-/Kleinschreibung trennt die Namen. |
| `bot.Redis`                              | Donts `redis.js` (`set/get/del`, JSON). Unser Cache heisst `bot.Cache` (`getJSON/setJSON`, Praefix `selfbot-next:`). Beide nutzen die DB-Nummer aus der config. |
| `bot.Utils`                              | Donts `misc`, erweitert um unsere Helfer (`timeDelta`, `tag`, ...) |

### Kompatibilitaetsschicht fuer `bot.DB` (Mongoose-Ersatz)

`src/database/db.js` ersetzt Donts mongoose-Datei (die beim Laden eine MongoDB-Verbindung oeffnet). Sie bietet fuer
die von Donts Handler und Commands benutzten Aufrufe dieselbe Form:

- `users` (`find`, `findOne`, `findOneAndUpdate`, `new users({...}).save()`, `.exec()`): liest/schreibt unsere
  `users`/`Users`-Services. `level` wird abgeleitet: Bot-Administrator = 3, gesperrter User (Filter `ban` global) = 0,
  sonst 1. Explizit gesetzte Dont-Level (Command `setlevel`) liegen in Donts Postgres.
- `channels`: Sicht auf `bot.Channels` (Felder `id`, `username`, `prefix`, `isChannel`, `offlineOnly`, `editors`,
  `optionalSettings`). Im Parallelbetrieb listet sie nur die Channels aus `onlyChannels` (so joint auch Donts
  `JoinChannels.js` nichts Fremdes).
- `poroCount`, `stable`, `private`, `bans`: allgemeiner Dokumentenspeicher in Donts Postgres
  (`doc_store(collection, id, doc jsonb)`). Nur damit Donts Poro-/Stable-Commands nicht abstuerzen, falls sie
  freigegeben werden.
- `updateUser(collection, newName, id)` wie bei Dont.

Warum Kompatibilitaetsschicht statt MongoDB: Mongo laeuft nur noch zur Migration, und ein zweites Datenmodell
neben unserem soll nicht entstehen. Unsere Daten bleiben die Wahrheit.

## 4. Einhaengepunkte (alle mit `// selfbot:` markiert)

| Datei                        | Zweck                                                                                       |
| ---------------------------- | ------------------------------------------------------------------------------------------- |
| `src/main.js`                | unsere Initialisierung (`require('./selfbot')`), Schalter fuer Donts persoenliche Teile (`!cookie` bei kattah, SocketConnection) |
| `src/util/twitch/connections.js` | Token-Erneuerung des IRC-Passworts statt statischem `twitch.oauth`, `rateLimits` aus config (Bot ist nicht verifiziert) |
| `src/clients/twitch.js`      | unsere Event-Handler zusaetzlich registrieren                                               |
| `src/clients/modules/commands.js` | Dont-Commands per Allow-/Blocklist aus der config laden (`dont.commands`)               |
| `src/database/redis.js`, `modules/timers.js` | DB-Nummer/Verbindung aus der config statt Standard-DB 0                       |
| `src/api/server.js`          | Port-/Pfad-Anpassung (Routen-Ordner relativ zum Projekt)                                   |

Donts Feature-Gruppen bleiben im Code, sind aber ueber `config.json` > `dont` abschaltbar oder laufen ins Leere
(Daten leer): Poro-Spiel, 7TV, Discord-Webhooks, Translate, `kattah`-Sonderfaelle, PubSub-/EventSub-Events aus
Donts Tabellen. **Unsere Features haengen von keinem davon ab.**

## 5. Konfiguration

Eine `config.json` mit zwei Gruppen von Schluesseln (beide Seiten lesen sie direkt):

- Dont: `postgres`, `backend`, `token`, `twitch`, `discord`, `twitter`
- unsere: `selfName`, `selfId`, `prefix`, `onlyChannels`, `parallelMode`, `redis`, `console`, `web`, `api`, `modules`, ...
- neu: `dont` = `{ "commands": { "disableAll": true, "whitelist": [], "blacklist": [] }, "kattahCookie": false, "stvSocket": false, "pubsub": false, "bannedChannels": false }`

`postgres` ist gemeinsam (Host/User/Passwort); Donts Datei setzt `database: 'dontaddthisbot'` selbst darueber, wir lesen
`postgres.database` fuer `selfbot_next`.

## 6. Parallelbetrieb und Tests

Eigener Prefix, nur `testaccountalexmoderat`, eigene Ports (11301+), eigene Postgres-Datenbanken, eigene Redis-DB.
Der alte Bot (`pm2 selfbot`) bleibt unberuehrt. Der Nachweis laeuft ueber `scripts/` plus `tests/`.

## 7. Offene Entscheidungen fuer alexmoderat

Siehe Bericht: welche Dont-Commands mitlaufen sollen (Standard: keine), ob Dont-Dashboard-API (poros.lol) gebraucht wird,
ob Poro-/7TV-Teile ueberhaupt bleiben sollen.
