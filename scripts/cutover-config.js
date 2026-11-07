// Stellt config.json beim Umschalten (scripts/cutover.sh) vom Parallelbetrieb auf den Normalbetrieb um.
//   node scripts/cutover-config.js config.json

const fs = require('node:fs');

const file = process.argv[2];
if (!file) {
	console.error('Pfad zur config.json fehlt');
	process.exit(2);
}

const config = JSON.parse(fs.readFileSync(file, 'utf8'));

config.prefix = 'sb';
delete config.onlyChannels;
delete config.parallelMode;
delete config.disableAltPrefix;

config.console.port = 11101;
config.web = { ...config.web, port: 11102, compatPort: 3000 };
config.api = { ...config.api, port: 11100 };
config.values.modLogChannel = 'alexmoderat_modlogs';

// Wie beim alten selfbot: nur vstop und join-check bleiben aus, alle Crons laufen
config.modules.commands.blacklist = ['vstop'];
config.modules.modules.blacklist = ['join-check'];
config.modules.crons.blacklist = [];

fs.writeFileSync(file, `${JSON.stringify(config, null, '\t')}\n`);
console.log(`${file}: Prefix ${config.prefix}, Ports ${config.console.port}/${config.web.port}/${config.api.port}/${config.web.compatPort}`);
