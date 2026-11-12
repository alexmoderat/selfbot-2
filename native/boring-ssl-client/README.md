# boring-ssl-client (Chrome-TLS-Fingerprint-Fallback)

Fork von [Potat-Industries/rust-boring-ssl-client](https://github.com/Potat-Industries/rust-boring-ssl-client)
(selbst ein Fork von gssvv/rust-boring-ssl-client). Rust/Neon-Addon, das einen
HTTP/2-Request mit Chromes TLS-Handshake-Signatur (Cipher-Liste, ALPN, GREASE
via BoringSSL) statt Node/axios' Standard-Fingerprint verschickt. Reiner
Request/Response-Client -- kein WebSocket, kein PubSub, kein Push.

## Wofuer

`getBanStatusBatch()` in `src/services/twitch-api.ts` pollt per GQL (axios)
alle 10s den Sperrstatus beobachteter Accounts/Channels (`ban-watch`/
`ban-check`-Crons). Twitch liefert fuer Sperren nachweislich keinen Push --
IRC, Hermes und EventSub-Revocation wurden einzeln getestet und blieben bei
Ban/Deaktivierung/Loeschung stumm (siehe Kopfkommentar
`v2/crons/ban-check/index.ts`). Dieses Addon aendert daran nichts: es bleibt
ein Poll, nur mit einem anderen TLS-Fingerprint.

Es ist deshalb ein reiner **Fallback**, kein Live-Mechanismus: Schlaegt der
normale axios-GQL-Request fehl, versucht `src/services/fingerprint-client.ts`
denselben Request einmal ueber dieses Addon, bevor der Fehler wie bisher nach
oben geworfen wird -- fuer den Fall, dass Twitch den GQL-Batch-Call
irgendwann per TLS-Fingerprint statt nur per Client-Integrity-Token blockt
(aktuell nicht beobachtet).

**Geaendert gegenueber dem Original:** Echte Zertifikats-/Hostname-Pruefung
statt `SslVerifyMode::NONE` -- das Original (fuer einen reinen
Fingerprint-Showcase gedacht) nahm die TLS-Vertrauenspruefung komplett raus.
Hier entscheidet die Antwort aber reale Aktionen (Channel-Part,
Ban-Ankuendigung), eine fehlende Zertifikatspruefung waere ein MITM-Risiko.

## Optional -- nicht Teil von `npm test`/`npm run build`

Ohne gebautes `build/<plattform>.node` bleibt der Fallback inaktiv und der
Bot verhaelt sich exakt wie vorher. Kein Rust-Toolchain auf dem CI- oder
Dev-Host noetig.

## Bauen (auf dem Zielhost, z.B. dem pm2-Server)

Getestet (20.10.2026, Ubuntu): `apt-get install -y cargo rustc cmake
libclang-dev clang` -- cmake und libclang sind noetig, weil `boring-sys`
BoringSSL selbst aus dem Quellcode baut (cmake) und die Rust-Bindings dafuer
per `bindgen` generiert (braucht libclang zum Parsen der C-Header). gcc/g++
und perl waren auf dem getesteten Host schon vorhanden.

```bash
cd native/boring-ssl-client
npm install
LIBCLANG_PATH=/usr/lib/llvm-21/lib npm run build-linux   # Pfad ggf. anpassen (`find / -iname libclang.so*`)
```

Ergebnis: `build/linux.node` (~3,7 MB), lokal end-to-end gegen
`gql.twitch.tv` getestet (echter 200er, echte Nutzerdaten zurueck).
`Cargo.lock`/`package-lock.json` sind committed fuer reproduzierbare Builds.

Danach `pm2 restart sb-v2` -- `fingerprint-client.ts` laedt das Addon beim
ersten Aufruf automatisch nach, kein weiterer Code noetig.
