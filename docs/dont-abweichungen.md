# Abweichungen von DontAddThisBot

Basis: `kattah7/DontAddThisBot`, Commit `c8d7308` (2023-07-31), ISC-Lizenz, Copyright Kattah. Donts `src/` liegt unter
`src/` (137 Dateien). **126 davon sind Byte fuer Byte identisch**, 11 weichen ab. Alles Eigene liegt in `src/selfbot/`,
`scripts/`, `tests/` und `docs/` (Konzept: [dont-konzept.md](dont-konzept.md)). Jede Abweichung ist im Code mit `// selfbot:`
markiert.

Nachpruefen, ohne Zahlen zu glauben:

```bash
git clone https://github.com/kattah7/DontAddThisBot /tmp/dont && git -C /tmp/dont checkout c8d7308
diff -rq /tmp/dont/src src --exclude=selfbot
```

## Dateien, die von Dont abweichen

| Datei                                                                                                                                                                               | Diff                 | Grund                                                                                                                                                                                                                                                   |
| ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `src/database/db.js`                                                                                                                                                                | ersetzt (445 Zeilen) | Donts Datei ist mongoose und verbindet beim Laden mit MongoDB. Ersatz: gleiche Aufrufe (`bot.DB.users.findOne(...).exec()` usw.) auf unseren Diensten und Donts Postgres, siehe Konzept Abschnitt 3. **Einzige echte Neuschreibung.**                   |
| `src/main.js`                                                                                                                                                                       | 20 Zeilen            | Ruft `src/selfbot/attach.js` auf (`bot.Ready`); Donts persoenliche/tote Teile per `config.json > dont` abschaltbar: `!cookie` bei kattah, PubSub (Twitch hat PubSub abgeschaltet), `bannedChannels`, 7TV-Socket, Donts API (`dont.api`). Standard: aus. |
| `src/util/twitch/connections.js`                                                                                                                                                    | 4 Zeilen             | Passwort aus `.env` (`TWITCH_USER_TOKEN`, fester Token) wenn `config.json` keinen `twitch.oauth` hat; `rateLimits` aus `twitch.rateLimits` (unser Konto ist nicht verifiziert, `'default'`).                                                            |
| `src/database/postgres.js`                                                                                                                                                          | 2 Zeilen             | Name der Dont-Tabellen-DB aus `postgres.dontDatabase` (Test: `selfbot_dont_tables`, Produktion: `dontaddthisbot`).                                                                                                                                      |
| `src/database/redis.js`, `src/clients/modules/timers.js`, `src/util/twitch/utils.js`, `src/commands/ping.js`, `src/api/routes/GET/channels.js`, `src/api/routes/GET/leaderboard.js` | je 2 Zeilen          | `new Redis({})` nutzt die Standard-DB 0; stattdessen die DB-Nummer aus `config.json > redis` (gleiche Zeile in allen sechs Dateien).                                                                                                                    |
| `src/util/twitch/utils.js`                                                                                                                                                          | +2 Zeilen            | `PoroNumberOne`: ohne Redis-Schluessel `leaderboardEndpoint` (Poro-Rangliste, wird nur von Donts Website gefuellt) warf jede Antwort einen Fehler. Jetzt leere Rangliste.                                                                               |
| `src/clients/modules/commands.js`                                                                                                                                                   | 2 Zeilen             | Dont-Commands nur laden, wenn `config.dont.commands` sie freigibt (`src/selfbot/dont-commands.js`). Standard: keine.                                                                                                                                    |

Nicht angefasst, obwohl sie Donts Daten anfassen: `handler.js`, `cooldown.js`, `updateUser.js`, `JoinChannels.js`,
`twitch.js`, alle Events (`PRIVMSG`, `USERNOTICE`, `CLEARCHAT`, `NOTICE`, `JOIN`, `PART`, `WHISPER`, `USERSTATE`),
`api/server.js`, `middleWare.js`, `rateLimit.js`, `getAvatar.js`, `handleEditor.js`, alle Routen, `eventSub*.js`,
`pubSub*.js`, `bannedChannels.js`, `misc/*`, `token/*`, alle 73 Commands bis auf `ping.js`.

## Dont-Dateien, die nicht uebernommen wurden

Nur Repo-Rahmen: `.github/`, `.husky/`, `README.md`, `imgs/`, `trash/`, `scripts/`, `yarn.lock`, `package.json` (unsere
`package.json` enthaelt Donts Abhaengigkeiten), `.eslintrc.yml` (ersetzt durch Ausnahmen in `eslint.config.js`), `.prettierrc.js`
(gleiche Werte wie unser `.prettierrc.js`, siehe `.prettierignore` fuer Donts Dateien).

## Bekannte Eigenheiten von Donts Code im Betrieb

- `postgres.js` ruft beim Verbinden die 7TV-GQL-v3-API (`GetStvRoles`) auf; die gibt es nicht mehr. Ergebnis: eine
  `Unhandled rejection ... 'roles'` im Log beim Start, die Tabellen werden vorher angelegt. Nicht behoben, damit die Datei Dont bleibt.
- Donts API (`dont.api`) laeuft unter Express 5 (alle Routen laden, `/api/bot/info`, `/api/bot/commands` antworten);
  `/api/bot/channels` liefert 500, solange Donts Redis-Cache `channelsEndpoint` leer ist.
- 7TV ist an: freigegeben sind `7tvpfp` und `7tvaddeditor` (`dont.commands.whitelist`). Nicht freigegeben, mit Grund:
  `7tvsa` (egvault.7tv.io gibt es nicht mehr), `stats` (api.kattah.me gibt es nicht mehr), `7tvemotes` (schickt hunderte Zeilen in den Chat),
  `7tv`, `add`, `remove`, `set` (Namen belegt durch unsere Commands, sonst antworten beide). `7tvaliasv4` und `7tvyoinkv4` (Flag `stv`)
  bleiben aus: Donts `handler.js` prueft dafuer den 7TV-Editor-Zugang fuer Donts Konto-ID `629d77a20e60c6d53da64e38`, nicht fuer unseres.
- Dont-Commands zu toten Diensten beenden unter Node 24 sonst den Prozess (got 11, 'error' ohne Abnehmer); `src/selfbot/util/crash-guard.js` loggt
  solche HTTP-Fehler nur.
- Lint: `eslint.config.js` schaltet fuer Donts Dateien einige Regeln ab (Donts eigene Konfiguration hatte `no-unused-vars` aus).
