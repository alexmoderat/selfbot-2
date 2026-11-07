# Repository Guidelines

## Ziel
`selfbot-next` ist der Neubau von alexmoderats Twitch-Bot (`/root/selfbot`) im Aufbau von
[DontAddThisBot](https://github.com/kattah7/DontAddThisBot) (alexmoderat, 07.11.2026: "den kompletten bot auf
dontaddthisbot umstellen nur mit unseren Features", IRC "alles exakt wie er"). Features, Antworten und Datenmodell
kommen aus selfbot; Aufbau, IRC-Anbindung und Stil von DontAddThisBot. Bauplan: `/root/.claude/plans/frolicking-marinating-sparkle.md`.

## Struktur (wie DontAddThisBot)
- `src/main.js` — Einstieg: `global.bot` (Config, DB, Redis, Utils, Logger, Live, Client, Twitch, Channels, Users, ...),
  Konsole, `client.on('ready')` -> `Twitch()`.
- `src/util/twitch/connections.js` — die eine `ChatClient`-Instanz (`@kararty/dank-twitch-irc`), Passwort = User-Token,
  wird alle 30 Minuten erneuert.
- `src/clients/twitch.js` — registriert `events/*.js` und joint (`JoinChannels.js`), dazu `send`/`whisper`/`join`/`part`.
- `src/clients/events/<IRC-BEFEHL>.js` — `client.on('PRIVMSG', ...)` usw.; PRIVMSG baut `msgData` mit `send()`.
- `src/clients/modules/` — `handler.js` (Ablauf wie selfbots Command.checkAndExecute), `commands.js` (laedt
  `src/commands/*.js`), `cooldown.js`, `parameters.js`, `invocation.js`, `levels.js`, `chat-modules.js`.
- `src/commands/<name>.js` — eine Datei pro Command:
  `module.exports = { name, aliases, cooldown, description, usage, flags, params, execute: async (client, msg) => ({ text, reply }) }`.
  `msg.args`, `msg.params`, `msg.invocation`, `msg.prefix`, `msg.sender` (User), `msg.channelData` (Channel),
  `msg.displayName`. Rueckgabe: `text` (Antwort), `reply: true` (als Twitch-Reply), `success`, `cooldown`, `whisper`.
  Neue Commands werden automatisch geladen (kein Index).
- `src/modules/<name>.js` — Chat-Module `{ name, scope, events: { message, usernotice, clearchat, ... } }`.
- `src/services/` — Channels, Users, Filter, Banphrase, AFK, Reminder, Datenschalter (`data-properties.js`: jede neue
  Channel-/User-Eigenschaft dort mit Typ deklarieren), Log.
- `src/database/` — `db.js` (mongoose, `nextId()` fuer numerische IDs), `models/`, `redis.js` (`getJSON`/`setJSON`).
- `src/token/` — `http.js` (fetch-Wrapper), `helix.js` (Tokens, Helix).
- `src/misc/` — `utility.js` (Ersatz fuer supi-core Utils), `logger.js`, `regex.js`, `long-timeout.js`, `haste.js`.
- `scripts/migrate-mariadb.js` — MariaDB -> MongoDB, wiederholbar (`yarn migrate [Tabelle ...]`).
- `tests/` — `node:test`, `*.test.js`.

## Befehle
- `yarn install`, `yarn test`, `yarn lint`, `yarn check` (beides), `yarn format:fix`.
- pm2: `pm2 restart selfbot-next`, Logs `pm2 logs selfbot-next` (`ecosystem.config.js`, Node 24 via nvm).
- Debug-Konsole: TCP `127.0.0.1:11201`, bekannten Usernamen eingeben, dann Commands mit Prefix.

## Parallelbetrieb (bis zum Umschalten)
Der alte selfbot laeuft weiter als `selfbot` auf demselben Twitch-Konto. Damit nie beide antworten, gilt in
`config.json`: `prefix: "sbn"`, `onlyChannels: ["testaccountalexmoderat"]`, `disableAltPrefix: true` (kein "!"),
`parallelMode: true` (keine AFK-Rueckkehr, keine Reminder-Ansagen). Eigene Ports (11201), Redis-DB 10, Mongo-DB
`selfbot_next`. MariaDB bleibt bis zum Umschalten die Quelle der Daten; eine erneute Migration ueberschreibt Mongo.

## Konventionen
- Plain JavaScript (CommonJS), Node 24, kein Build. Prettier wie DontAddThisBot (Tabs, einfache Anfuehrungszeichen).
- Chat-Antworten Englisch wie bisher, Kommentare und Logs Deutsch.
- MongoDB 8.2 im Docker-Container `selfbot-mongo` (127.0.0.1:27017, WiredTiger-Cache 1 GB). Achtung: Kernel 7.0.0 hat
  einen bekannten Fehler mit MongoDB (SERVER-121912, behoben ab 7.0.14), 8.2 startet nur, weil die Pruefung fehlt.
  Taegliches Backup: `/root/backups/mongo-backup.sh` (Cron 04:30, 7 Tage).
- Abfragen nur als Objekte (kein `$where`, keine zusammengesetzten Strings). Numerische `_id` wie in MariaDB.
- Unsichtbare Zeichen in Regexes und Strings immer als `\u…`-Escape schreiben.
- Alle Server binden an `127.0.0.1`.
- Commits auf Deutsch (`feat: …`, `fix: …`), Tests im selben Commit.

## Sicherheit
- `.env` und `config.json` sind git-ignoriert und enthalten echte Zugangsdaten.
- Der Bot laeuft als alexmoderat selbst. Twitch schickt eigene IRC-Nachrichten nicht an dieselbe Verbindung zurueck;
  Nachrichten von alexmoderat aus anderen Quellen (Browser, alter Bot) kommen an und werden normal verarbeitet.
- Refresh-Token: neue Werte in `.env` gewinnen automatisch gegen den in Redis gespeicherten Stand.
