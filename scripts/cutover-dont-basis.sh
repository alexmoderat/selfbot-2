#!/usr/bin/env bash
# Hauptbot (pm2 "selfbot") auf die Dont-Basis umstellen: Branch claude/dont-basis-b1939c in main mergen, config.json um die
# Dont-Schluessel ergaenzen, Dont-Tabellen-DB anlegen, testen, neu starten. Voraussetzung: claude/chat-data-pg ist schon in main
# (scripts/cutover-chat-data.sh bzw. der Umschaltlauf). Siehe docs/dont-konzept.md.
#
#   bash scripts/cutover-dont-basis.sh             zeigt nur, was passieren wuerde
#   bash scripts/cutover-dont-basis.sh --go        fuehrt aus
#   bash scripts/cutover-dont-basis.sh --rollback  main auf den Stand davor zuruecksetzen, config.json zurueck, neu starten
set -euo pipefail

NEXT=/root/selfbot-next
BRANCH=claude/dont-basis-b1939c
BACKUP_DIR=/root/backups/cutover-dont-basis
DONT_DB=dontaddthisbot
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

trap 'echo "!! Abgebrochen (Zeile $LINENO). Zurueck: bash scripts/cutover-dont-basis.sh --rollback" >&2' ERR

if [[ "$MODE" == "--rollback" ]]; then
	echo "== Rollback Hauptbot"
	run "test -f $BACKUP_DIR/before.sha"
	run "git -C $NEXT reset --hard \$(cat $BACKUP_DIR/before.sha)"
	run "cp $BACKUP_DIR/config.json $NEXT/config.json"
	run "cd $NEXT && yarn install --immutable"
	run "pm2 restart selfbot --update-env && pm2 save"
	echo "Die Datenbank $DONT_DB bleibt bestehen (enthaelt nur Donts leere Tabellen); Entfernen: sudo -u postgres dropdb $DONT_DB"
	exit 0
fi

if [[ "$MODE" != "plan" && "$MODE" != "--go" ]]; then
	echo "Unbekannte Option: $MODE (erlaubt: --go, --rollback)" >&2
	exit 2
fi

echo "== 0. Vorabpruefung"
run "git -C $NEXT diff --quiet && git -C $NEXT diff --cached --quiet"
run "git -C $NEXT show-ref --verify --quiet refs/heads/$BRANCH"
run "git -C $NEXT merge-base --is-ancestor claude/chat-data-pg main"
run "test -f $NEXT/config.json"

echo "== 1. Sicherung nach $BACKUP_DIR"
run "mkdir -p $BACKUP_DIR"
run "cp $NEXT/config.json $BACKUP_DIR/config.json"
run "git -C $NEXT rev-parse HEAD > $BACKUP_DIR/before.sha"

echo "== 2. Dont-Tabellen-DB $DONT_DB (gleiche Rolle wie selfbot_next) und config.json ergaenzen"
run "sudo -u postgres psql -tAc \"select 1 from pg_database where datname='$DONT_DB'\" | grep -q 1 || sudo -u postgres createdb -O selfbot_next $DONT_DB"
# Nur ergaenzen, nichts ueberschreiben: Dont liest twitch/backend/token/postgres direkt aus config.json
run "node -e \"
const fs=require('fs');const p='$NEXT/config.json';const c=JSON.parse(fs.readFileSync(p,'utf8'));
c.postgres.dontDatabase??='$DONT_DB';
const env=fs.readFileSync('$NEXT/.env','utf8').match(/^API_7TV_TOKEN=(.*)\$/m);
c.twitch={username:c.selfName,rateLimits:'default',stv_token:env?env[1]:'',...c.twitch};
c.backend={port:11303,origin:'http://localhost',client_id:'',client_secret:'',callback_url:'',...c.backend};
c.token={key:require('crypto').randomBytes(32).toString('hex'),...c.token};
c.dont={api:false,pubsub:false,kattahCookie:false,bannedChannels:false,stvSocket:false,commands:{disableAll:false,whitelist:['7tvaddeditor','7tvpfp'],blacklist:[]},...c.dont};
fs.writeFileSync(p,JSON.stringify(c,null,1)+'\n');
\""

echo "== 3. Branch mergen, Abhaengigkeiten, Tests (vor dem Neustart)"
run "git -C $NEXT -c user.name=alexmoderat -c user.email=manderby@web.de merge --no-edit $BRANCH"
run "cd $NEXT && yarn install --immutable"
run "cd $NEXT && yarn test"

echo "== 4. Hauptbot neu starten"
run "pm2 restart selfbot --update-env && pm2 save"
echo "== Danach pruefen: pm2 logs selfbot ('Bereit - 127 Commands ...', 'Connected to SQL database!'), 'sb ping', 'sb ask hallo', Dashboard-Login."
echo "   Der Fehler 'Cannot destructure property roles' im Log ist erwartet (7TV-GQL v3 existiert nicht mehr, Donts postgres.js)."
