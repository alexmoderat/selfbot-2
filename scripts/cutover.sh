#!/usr/bin/env bash
# Umschalten selfbot (TypeScript, /root/selfbot) -> selfbot-next (dieses Repo), Phase 7.
#
#   bash scripts/cutover.sh             zeigt nur, was passieren wuerde
#   bash scripts/cutover.sh --go        fuehrt aus
#   bash scripts/cutover.sh --rollback  zurueck: neuen Bot wieder in den Parallelbetrieb, alten selfbot starten
#
# nginx bleibt unveraendert (auth.alexmoderat.eu zeigt schon auf 11102 bzw. 3000). Redis bleibt auf DB 10 und Mongo
# auf selfbot_next, damit der alte Bot beim Rollback seinen Stand (Redis-DB 9, MariaDB) unberuehrt vorfindet.
set -euo pipefail

NEXT=/root/selfbot-next
OLD=/root/selfbot
BACKUP_DIR=/root/backups/cutover-next
MODE=${1:-plan}

export NVM_DIR=/root/.nvm
# shellcheck disable=SC1091
source "$NVM_DIR/nvm.sh" >/dev/null

run () {
	echo "+ $*"
	if [[ "$MODE" == "--go" || "$MODE" == "--rollback" ]]; then
		eval "$@"
	fi
}

trap 'echo "!! Abgebrochen (Zeile $LINENO). Zurueck zum alten Stand: bash scripts/cutover.sh --rollback" >&2' ERR

if [[ "$MODE" == "--rollback" ]]; then
	echo "== Rollback auf den alten selfbot"
	run "pm2 delete selfbot"
	run "cp $BACKUP_DIR/config.json $NEXT/config.json"
	run "cp $BACKUP_DIR/ecosystem.config.js $NEXT/ecosystem.config.js"
	run "pm2 start $OLD/ecosystem.config.cjs"
	run "pm2 start $NEXT/ecosystem.config.js"
	run "pm2 save"
	echo "Fertig: alter selfbot laeuft wieder (Prefix sb), selfbot-next im Parallelbetrieb (Prefix sbn, nur Testchannel)."
	echo "Was der neue Bot in der Zwischenzeit geschrieben hat, liegt nur in MongoDB, nicht in MariaDB."
	exit 0
fi

if [[ "$MODE" != "plan" && "$MODE" != "--go" ]]; then
	echo "Unbekannte Option: $MODE (erlaubt: --go, --rollback)" >&2
	exit 2
fi

echo "== 1. Sicherungen nach $BACKUP_DIR"
run "mkdir -p $BACKUP_DIR"
run "cp $NEXT/config.json $BACKUP_DIR/config.json"
run "cp $NEXT/ecosystem.config.js $BACKUP_DIR/ecosystem.config.js"
run "docker exec selfbot-mongo mongodump --quiet --archive --gzip --db selfbot_next > $BACKUP_DIR/selfbot_next.archive.gz"

echo "== 2. Beide Bots stoppen (MariaDB einfrieren, Twitch-Account und Firehose-Platz frei)"
run "pm2 stop selfbot selfbot-next"
run "mysqldump --single-transaction --databases selfbot_core selfbot_data | gzip > $BACKUP_DIR/selfbot-core-data.sql.gz"

echo "== 3. Letzte Migration: Kern und Daten neu, Chat-Logs als Delta, dann Abgleich (bricht bei Abweichung ab)"
run "cd $NEXT && yarn migrate --fresh"
run "cd $NEXT && yarn migrate:chatlines"
run "cd $NEXT && yarn migrate:check"

echo "== 4. Konfiguration: Prefix sb, alle Channels, Ports des alten selfbot, gesperrte Module/Crons wieder an"
run "node $NEXT/scripts/cutover-config.js $NEXT/config.json"

echo "== 5. pm2: alten selfbot austragen, neuen Bot als 'selfbot' starten"
run "sed -i \"s/name: 'selfbot-next'/name: 'selfbot'/\" $NEXT/ecosystem.config.js"
run "pm2 delete selfbot selfbot-next"
run "pm2 start $NEXT/ecosystem.config.js && pm2 save"

echo "== Danach pruefen: pm2 logs selfbot ('Bereit - ...', '[pubsub] ... Verbindung', kein 'Parallelbetrieb'),"
echo "   'sb ping' in einigen Channels, https://auth.alexmoderat.eu/status, Dashboard-Login."
echo "   Rueckweg: bash scripts/cutover.sh --rollback"
