#!/usr/bin/env bash
# Hauptbot (pm2 "selfbot") von MariaDB chat_data auf Postgres utility_next umstellen: Branch claude/chat-data-pg in main mergen,
# testen, neu starten. Erst NACH dem Umschalten von utility-next ausfuehren (sonst veraltete Daten).
#
#   bash scripts/cutover-chat-data.sh             zeigt nur, was passieren wuerde
#   bash scripts/cutover-chat-data.sh --go        fuehrt aus
#   bash scripts/cutover-chat-data.sh --rollback  main auf den Stand davor zuruecksetzen und neu starten
set -euo pipefail

NEXT=/root/selfbot-next
BRANCH=claude/chat-data-pg
BACKUP_DIR=/root/backups/cutover-chat-data
MODE=${1:-plan}

export NVM_DIR=/root/.nvm
# shellcheck disable=SC1091
source "$NVM_DIR/nvm.sh" >/dev/null
nvm use 24 >/dev/null

run () {
	echo "+ $*"
	if [[ "$MODE" == "--go" || "$MODE" == "--rollback" ]]; then
		eval "$@"
	fi
}

trap 'echo "!! Abgebrochen (Zeile $LINENO). Zurueck: bash scripts/cutover-chat-data.sh --rollback" >&2' ERR

if [[ "$MODE" == "--rollback" ]]; then
	echo "== Rollback Hauptbot"
	run "test -f $BACKUP_DIR/before.sha"
	run "git -C $NEXT reset --hard \$(cat $BACKUP_DIR/before.sha)"
	run "cp $BACKUP_DIR/config.json $NEXT/config.json"
	run "cd $NEXT && yarn install --immutable"
	run "pm2 restart selfbot --update-env && pm2 save"
	exit 0
fi

if [[ "$MODE" != "plan" && "$MODE" != "--go" ]]; then
	echo "Unbekannte Option: $MODE (erlaubt: --go, --rollback)" >&2
	exit 2
fi

echo "== 0. Vorabpruefung"
run "git -C $NEXT diff --quiet && git -C $NEXT diff --cached --quiet"
run "git -C $NEXT show-ref --verify --quiet refs/heads/$BRANCH"
run "node -e \"const c=require('$NEXT/config.json'); if(!c.utilityPostgres||!c.utilityPostgres.password) process.exit(1)\""
run "PGPASSWORD=\$(node -p \"require('$NEXT/config.json').utilityPostgres.password\") psql -h 127.0.0.1 -U selfbot_utility -d utility_next -Atc 'select count(*) from longest_sub'"

echo "== 1. Sicherung nach $BACKUP_DIR"
run "mkdir -p $BACKUP_DIR"
run "cp $NEXT/config.json $BACKUP_DIR/config.json"
run "git -C $NEXT rev-parse HEAD > $BACKUP_DIR/before.sha"

echo "== 2. Branch mergen, Abhaengigkeiten, Tests (vor dem Neustart)"
run "git -C $NEXT -c user.name=alexmoderat -c user.email=manderby@web.de merge --no-edit $BRANCH"
run "cd $NEXT && yarn install --immutable"
run "cd $NEXT && yarn test"

echo "== 3. Hauptbot neu starten"
run "pm2 restart selfbot --update-env && pm2 save"
echo "== Danach pruefen: pm2 logs selfbot ('Bereit - ...', keine '[utility-db] Abfrage fehlgeschlagen'), 'sb sightings <user>', Reminder-Seite im Dashboard."
