#!/usr/bin/env bash
# Umschalten des laufenden Bots (pm2 "selfbot", /root/selfbot-next) von MongoDB auf Postgres und auf den Aufbau wie
# DontAddThisBot (Branch claude/bot-dontaddthisbot-structure-c4031d).
#
#   bash scripts/cutover-postgres.sh             zeigt nur, was passieren wuerde
#   bash scripts/cutover-postgres.sh --go        fuehrt aus
#   bash scripts/cutover-postgres.sh --rollback  zurueck auf den Stand vor dem Umschalten (MongoDB)
#
# Wichtig: MariaDB ist veraltet, die Daten seit dem ersten Umschalten liegen nur in MongoDB. Deshalb kopiert
# "yarn migrate:mongo" Mongo -> Postgres. Beim Rollback geht alles verloren, was der Bot danach in Postgres geschrieben hat
# (MongoDB bleibt unveraendert auf dem Stand vom Stopp).
#
# Voraussetzungen: Postgres-Datenbank selfbot_next und config.json "postgres" (beides angelegt), Branch committet.
set -euo pipefail

NEXT=/root/selfbot-next
BRANCH=claude/bot-dontaddthisbot-structure-c4031d
BACKUP_DIR=/root/backups/cutover-postgres
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

trap 'echo "!! Abgebrochen (Zeile $LINENO). Zurueck zum Stand vor dem Umschalten: bash scripts/cutover-postgres.sh --rollback" >&2' ERR

if [[ "$MODE" == "--rollback" ]]; then
	echo "== Rollback auf MongoDB"
	run "pm2 stop selfbot"
	run "test -f $BACKUP_DIR/before.sha"
	run "[ ! -f $BACKUP_DIR/merge.subject ] || test \"\$(git -C $NEXT log -1 --format=%s)\" = \"\$(cat $BACKUP_DIR/merge.subject)\""
	run "git -C $NEXT reset --hard \$(cat $BACKUP_DIR/before.sha)"
	run "cp $BACKUP_DIR/config.json $NEXT/config.json"
	run "cd $NEXT && yarn install --immutable"
	run "pm2 start selfbot && pm2 save"
	echo "Fertig: Bot laeuft wieder mit MongoDB. Was seit dem Umschalten in Postgres geschrieben wurde, ist nicht in MongoDB."
	exit 0
fi

if [[ "$MODE" != "plan" && "$MODE" != "--go" ]]; then
	echo "Unbekannte Option: $MODE (erlaubt: --go, --rollback)" >&2
	exit 2
fi

echo "== 0. Vorabpruefung"
run "git -C $NEXT diff --quiet || { echo 'Arbeitsverzeichnis hat Aenderungen (z. B. geloeschte AGENTS.md) - erst committen oder zuruecksetzen, sonst scheitert der Merge'; exit 1; }"
run "git -C $NEXT show-ref --verify --quiet refs/heads/$BRANCH"
run "node -e \"const c=require('$NEXT/config.json'); if(!c.postgres||!c.mongo) process.exit(1)\""
run "PGPASSWORD=\$(node -p \"require('$NEXT/config.json').postgres.password\") psql -h 127.0.0.1 -U selfbot_next -d selfbot_next -Atc 'select 1'"

echo "== 1. Sicherungen nach $BACKUP_DIR"
run "mkdir -p $BACKUP_DIR"
run "cp $NEXT/config.json $BACKUP_DIR/config.json"
run "git -C $NEXT rev-parse HEAD > $BACKUP_DIR/before.sha"
run "docker exec selfbot-mongo mongodump --quiet --archive --gzip --db selfbot_next > $BACKUP_DIR/selfbot_next.mongo.archive.gz"

echo "== 2. Bot stoppen (MongoDB einfrieren)"
run "pm2 stop selfbot"

echo "== 3. Neuen Stand holen (Merge des Branches) und Abhaengigkeiten installieren"
run "git -C $NEXT -c user.name=alexmoderat -c user.email=manderby@web.de merge --no-edit $BRANCH"
run "git -C $NEXT log -1 --format=%s > $BACKUP_DIR/merge.subject"
run "cd $NEXT && yarn install --immutable"

echo "== 4. Daten kopieren: MongoDB -> Postgres, mit Zeilenzahl-Abgleich (bricht bei Abweichung ab)"
run "cd $NEXT && yarn migrate:mongo --fresh"

echo "== 5. Bot starten"
run "pm2 restart selfbot && pm2 save"

echo "== Danach pruefen: pm2 logs selfbot ('[db] Mit Postgres verbunden', 'Bereit - ...'), 'sb ping' bzw. '!ping' in einigen"
echo "   Channels, https://auth.alexmoderat.eu/status, Dashboard-Login. Rueckweg: bash scripts/cutover-postgres.sh --rollback"
