// Hilfe fuer die Umstellung: TS-Datei aus selfbot -> CommonJS-Rohfassung fuer selfbot-next.
// Entfernt Typen (Layout und Kommentare bleiben), schreibt import/export um, biegt Pfade auf die neue Struktur und
// ersetzt eindeutige API-Namen. DB-Zugriffe (core.Query) und Command-Kontext muessen danach von Hand angepasst werden;
// das Skript markiert sie mit "TODO(port)".
//
//   node scripts/port-ts.js <quelle.ts> <ziel.js>

const { readFileSync, writeFileSync, mkdirSync } = require('node:fs');
const path = require('node:path');
const { stripTypeScriptTypes } = require('node:module');

const SELFBOT = '/root/selfbot';
const NEXT = path.join(__dirname, '..');

/** Ziel einer selfbot-Datei in selfbot-next (ohne Endung) */
const targetOf = (relative) => {
	const rel = relative.replace(/\.ts$/, '');
	const rules = [
		// schon vorhandene Gegenstuecke im neuen Aufbau
		[/^singletons\/logger$/, 'src/services/log'],
		[/^utils\/command-levels$/, 'src/clients/modules/levels'],
		[/^utils\/invocation$/, 'src/clients/modules/invocation'],
		[/^utils\/parameters$/, 'src/clients/modules/parameters'],
		[/^utils\/cooldown-manager$/, 'src/clients/modules/cooldown'],
		[/^utils\/regexes$/, 'src/misc/regex'],
		[/^classes\/command$/, 'src/clients/modules/commands'],
		[/^classes\/chat-module$/, 'src/clients/modules/chat-modules'],
		[/^classes\/cron$/, 'src/clients/modules/timers'],
		// Hilfsdateien eines Commands (Unterordner); der Loader laedt nur src/commands/*.js
		[/^commands\/([^/]+)\/(?!index$)(.+)$/, 'src/util/commands/$1/$2'],
		[/^utils\/(.+)$/, 'src/util/$1'],
		[/^singletons\/(.+)$/, 'src/services/$1'],
		[/^platforms\/twitch-utils$/, 'src/util/twitch/twitch-utils'],
		[/^platforms\/hermes-client$/, 'src/util/twitch/hermes-client'],
		[/^chat-modules\/([^/]+)\/index$/, 'src/modules/$1'],
		[/^crons\/([^/]+)\/index$/, 'src/crons/$1'],
		[/^commands\/([^/]+)\/index$/, 'src/commands/$1'],
		[/^classes\/afk$/, 'src/services/afk'],
		[/^classes\/filter$/, 'src/services/filter'],
		[/^classes\/reminder$/, 'src/services/reminders'],
		[/^classes\/banphrase$/, 'src/services/banphrase'],
		[/^classes\/channel$/, 'src/services/channels'],
		[/^classes\/user$/, 'src/services/users'],
		[/^classes\/custom-data-properties$/, 'src/services/data-properties'],
		[/^config$/, 'src/config'],
		[/^web\/(.+)$/, 'src/api/$1'],
		[/^api\/index$/, 'src/api/internal'],
	];
	for (const [regex, replacement] of rules) {
		if (regex.test(rel)) {
			return rel.replace(regex, replacement);
		}
	}
	return `src/TODO-${rel}`;
};

const API_RENAMES = [
	[/\bcore\.Utils\./g, 'bot.Utils.'],
	[/\bcore\.Cache\.getByPrefix\(/g, 'bot.Redis.getJSON('],
	[/\bcore\.Cache\.setByPrefix\(/g, 'bot.Redis.setJSON( /* TODO(port): expiry-Objekt -> ms */ '],
	[/\bsb\.Channel\.getJoinableForPlatform\([^)]*\)/g, 'bot.Channels.getJoinable()'],
	// Plattform-Argument (immer Twitch) entfaellt; zuerst die Form mit sb.Platform.get(...), dann der Rest
	[
		/\bsb\.Channel\.(get|getBySpecificId)\(([^,()]+),\s*(?:sb\.Platform\.get(?:Asserted)?\("twitch"\)|this|platform|twitch|context\.platform)\)/g,
		(_m, kind, arg) => `bot.Channels.${kind === 'get' ? 'get' : 'getByTwitchId'}(${arg})`,
	],
	[/\bsb\.Channel\.getBySpecificId\(([^,()]+)\)/g, 'bot.Channels.getByTwitchId($1)'],
	[/\bsb\.Channel\.get\(([^,()]+)\)/g, 'bot.Channels.get($1)'],
	[/\bsb\.Channel\b/g, 'bot.Channels'],
	[/\bsb\.User\.getOrCreate\(/g, 'bot.Users.getOrCreate('],
	[/\bsb\.User\.get\(/g, 'bot.Users.get('],
	[/\bsb\.User\b/g, 'bot.Users'],
	[/\bsb\.Command\.prefix\b/g, 'bot.Config.prefix'],
	[/\bsb\.Reminder\b/g, 'bot.Reminders'],
	[/\bsb\.AwayFromKeyboard\b/g, 'bot.AFK'],
	[/\bsb\.Filter\b/g, 'bot.Filter'],
	[/\bsb\.ChatModule\.dispatch\(/g, 'bot.ChatModules.dispatch('],
	[/\bsb\.Platform\.get(?:Asserted)?\("twitch"\)/g, 'TODO_PORT_PLATFORM'],
	// Command-Kontext -> msg
	[/\bcontext\.getBestAvailableEmote\(/g, 'msg.getBestAvailableEmote('],
	[/\bcontext\.sendIntermediateMessage\(/g, 'msg.send('],
	[/\bcontext\.messageLimit\b/g, 'bot.Config.messageLimit'],
	[/\bcontext\.command\b/g, 'msg.command'],
	[/\bsb\.Command\.get\(/g, 'getCommand('],
	[/\bsb\.Command\.data\b/g, 'commands'],
	[/\bsb\.User\.normalizeUsername\(/g, 'bot.Users.normalizeUsername('],
	[/\bcontext\.displayName\b/g, 'msg.displayName'],
	[/\bcontext\.user\.ID\b/g, 'msg.sender.id'],
	[/\bcontext\.user\.Name\b/g, 'msg.sender.name'],
	[/\bcontext\.user\.Twitch_ID\b/g, 'msg.sender.twitchId'],
	[/\bcontext\.user\b/g, 'msg.sender'],
	[/\bcontext\.channel\?\.ID\b/g, 'msg.channelData?.id'],
	[/\bcontext\.channel\.ID\b/g, 'msg.channelData.id'],
	[/\bcontext\.channel\?\.Name\b/g, 'msg.channelData?.name'],
	[/\bcontext\.channel\.Name\b/g, 'msg.channelData.name'],
	[/\bcontext\.channel\?\.Specific_ID\b/g, 'msg.channelData?.twitchId'],
	[/\bcontext\.channel\.Specific_ID\b/g, 'msg.channelData.twitchId'],
	[/\bcontext\.channel\b/g, 'msg.channelData'],
	[/\bcontext\.params\b/g, 'msg.params'],
	[/\bcontext\.invocation\b/g, 'msg.invocation'],
	[/\bcontext\.usedPrefix\b/g, 'msg.prefix'],
	[/\bcontext\.privateMessage\b/g, 'msg.privateMessage'],
	[/\bcontext\.isBroadcaster\b/g, 'msg.user.perms.broadcaster'],
	[/\bawait context\.getUserPermissions\(\)/g, 'getPermissions(msg)'],
	[/\bcontext\.platformSpecificData\?\.badges\b/g, 'msg.user.badges'],
	[/\bcontext\.platformSpecificData\?\.messageId\b/g, 'msg.id'],
	[/\bcontext\.platformSpecificData\b/g, 'msg /* TODO(port): platformSpecificData */'],
	[/\bcontext\.platform\b/g, 'TODO_PORT_PLATFORM'],
	// Entitaeten: Felder von Channel-/User-Objekten in camelCase
	[
		/\b(\w*(?:[cC]hannel|[uU]ser)\w*|sender)(\??)\.(Name|ID|Mode|Description)\b/g,
		(_m, receiver, optional, field) => `${receiver}${optional}.${{ Name: 'name', ID: 'id', Mode: 'mode', Description: 'description' }[field]}`,
	],
	[/\.Specific_ID\b/g, '.twitchId'],
	[/\.Twitch_ID\b/g, '.twitchId'],
	[/\.Links_Allowed\b/g, '.linksAllowed'],
	// Datenschalter: Empfaenger mit "channel" im Namen -> Channels, mit "user"/"sender" -> Users
	[
		/([\w.?]+)\.(get|set)DataProperty\(/g,
		(match, receiver, kind) => {
			const service = /channel/i.test(receiver) ? 'Channels' : /user|sender/i.test(receiver) ? 'Users' : null;
			return service ? `bot.${service}.${kind}Data(${receiver.replace(/\?$/, '')}, ` : `${receiver}.${kind}DataProperty_TODO(`;
		},
	],
	// Redis mit Ablaufzeit: setByPrefix(key, value, { expiry: x }) -> setJSON(key, value, x)
	[/bot\.Redis\.setJSON\( \/\* TODO\(port\): expiry-Objekt -> ms \*\/ ([^;]*?), \{ expiry: ([^{}]+?) \}\)/g, 'bot.Redis.setJSON($1, $2)'],
	[/bot\.Redis\.setJSON\( \/\* TODO\(port\): expiry-Objekt -> ms \*\/ ([^;{}]*?)\)/g, 'bot.Redis.setJSON($1)'],
	// Plattform-Objekt -> bot.Twitch (gleiche Methodennamen)
	[/TODO_PORT_PLATFORM/g, 'bot.Twitch'],
	[/\bsb\.Platform\.list\b/g, '[bot.Twitch]'],
	// Channel-Methoden -> Service-Funktionen
	[/\b([\w.]+)\.saveProperty\(/g, 'bot.Channels.saveProperty($1, '],
	[/\b(\w*[cC]hannel\w*)\.send\(/g, 'bot.Channels.send($1, '],
	[/\b(\w*[cC]hannel\w*)\.isLive\(\)/g, 'bot.Channels.isLive($1)'],
	[/\b(\w*[cC]hannel\w*)\.writable\b/g, 'bot.Channels.isWritable($1)'],
	[/\bbot\.Channels\.data\.values\(\)/g, 'bot.Channels.all()'],
	[/\bsb\.ChatModule\.dispatchPubSub\(/g, 'bot.ChatModules.dispatchPubSub('],
	[/\bsb\.ChatModule\.isAttached\(/g, 'bot.ChatModules.isAttached('],
	// core.Query.getRow -> bot.DB.getRow (gleiche Bedienung, Collection statt Tabelle)
	[
		/\bcore\.Query\.getRow(?:<[^>]*>)?\(\s*["'](selfbot_core|selfbot_data)["']\s*,\s*["']([A-Za-z_]+)["']\s*\)(\s*;?\s*\/\/ TODO\(port\))?/g,
		(_m, schema, table) => {
			const core = { User_Alias: 'User', Reminder_History: 'ReminderHistory', Error: 'ErrorLog', Command_Execution: 'CommandExecution' };
			return `bot.DB.getRow('${schema === 'selfbot_core' ? (core[table] ?? table) : table.replaceAll('_', '')}')`;
		},
	],
	// supi-core Got -> src/token/got.js (gleiche Aufrufform)
	[/\bcore\.Got\.get\(/g, 'got('],
	[/\bcore\.Got\.gql\(/g, 'got.gql('],
];

/** Importe aus supi-core auf die uebernommenen Klassen bzw. Ersatzfunktionen */
const SUPI_CORE_IMPORTS = {
	SupiDate: ['src/util/date', 'default'],
	SupiError: ['src/util/error', 'SupiError'],
	GenericRequestError: ['src/util/error', 'GenericRequestError'],
	isGenericRequestError: ['src/util/error', 'isGenericRequestError'],
	isGotRequestError: ['src/token/http', 'isHttpError'],
};

const convertImports = (code, sourceDir, targetFile) => {
	const relativeRequire = (spec) => {
		if (!spec.startsWith('.')) {
			return spec;
		}
		const absolute = path.resolve(sourceDir, spec);
		const relativeToSelfbot = path.relative(SELFBOT, absolute);
		const target = path.join(NEXT, targetOf(relativeToSelfbot));
		let result = path.relative(path.dirname(targetFile), target);
		if (!result.startsWith('.')) {
			result = `./${result}`;
		}
		return spec.endsWith('.json') ? `${result}` : `${result}.js`;
	};

	const requireOf = (target) => {
		let result = path.relative(path.dirname(targetFile), path.join(NEXT, target));
		if (!result.startsWith('.')) {
			result = `./${result}`;
		}
		return `${result}.js`;
	};

	// import X, { a, b as c } from "y";  import * as z from "y";  import "y";
	return code
		.replace(/^import\s+(?:type\s+)?\{([^}]*)\}\s*from\s+["']supi-core["'];?/gm, (_m, names) =>
			names
				.split(',')
				.map((i) => i.trim())
				.filter((i) => i && !i.startsWith('type ') && SUPI_CORE_IMPORTS[i])
				.map((name) => {
					const [target, exported] = SUPI_CORE_IMPORTS[name];
					return exported === 'default'
						? `const ${name} = require('${requireOf(target)}');`
						: `const { ${exported === name ? name : `${exported}: ${name}`} } = require('${requireOf(target)}');`;
				})
				.join('\n'),
		)
		.replace(/^import\s+\*\s+as\s+(\w+)\s+from\s+["']([^"']+)["'];?/gm, (_m, name, spec) => `const ${name} = require('${relativeRequire(spec)}');`)
		.replace(/^import\s+(\w+)\s*,\s*\{([^}]*)\}\s*from\s+["']([^"']+)["'](?:\s+with\s*\{[^}]*\})?;?/gm, (_m, def, names, spec) => {
			const file = relativeRequire(spec);
			return `const ${def} = require('${file}');\nconst {${names.replaceAll(/\s+as\s+/g, ': ')}} = require('${file}');`;
		})
		.replace(/^import\s+\{([^}]*)\}\s*from\s+["']([^"']+)["'];?/gm, (_m, names, spec) => {
			const cleaned = names
				.split(',')
				.map((i) => i.trim())
				.filter((i) => i && !i.startsWith('type '))
				.map((i) => i.replace(/\s+as\s+/, ': '));
			return cleaned.length === 0 ? '' : `const { ${cleaned.join(', ')} } = require('${relativeRequire(spec)}');`;
		})
		.replace(
			/^import\s+(\w+)\s+from\s+["']([^"']+)["'](?:\s+with\s*\{[^}]*\})?;?/gm,
			(_m, name, spec) => `const ${name} = require('${relativeRequire(spec)}');`,
		)
		.replace(/^import\s+["']([^"']+)["'];?/gm, (_m, spec) => `require('${relativeRequire(spec)}');`);
};

const convertExports = (code) => {
	const names = [];
	let result = code
		.replace(/^export\s+(const|let|function|async function|class)\s+(\w+)/gm, (_m, kind, name) => {
			names.push(name);
			return `${kind} ${name}`;
		})
		.replace(/^export\s+\{([^}]*)\};?/gm, (_m, list) => {
			names.push(
				...list
					.split(',')
					.map((i) => i.trim().replace(/\s+as\s+/, ': '))
					.filter(Boolean),
			);
			return '';
		});

	const hasDefault = /^export default /m.test(result);
	result = result.replace(/^export default /m, 'module.exports = ');
	if (names.length > 0) {
		result += hasDefault ? `\nObject.assign(module.exports, { ${names.join(', ')} });\n` : `\nmodule.exports = { ${names.join(', ')} };\n`;
	}
	return result;
};

/** declare({ Name, Aliases, ... Code: async function x (context, ...args) {}) }) -> DATB-Format */
const convertCommand = (input) => {
	let code = input;
	const declareStart = code.indexOf('module.exports = declare({');
	if (declareStart !== -1) {
		// Ende von declare({...}): erste Zeile "});" danach
		const close = code.indexOf('\n});', declareStart);
		if (close !== -1) {
			code = code.slice(0, close) + '\n};' + code.slice(close + 4);
		}
		code = code.replace('module.exports = declare({', 'module.exports = {');
	}

	// Code: (async) function name (context, a, b) { ... }  -> execute: async (client, msg) => { const [a, b] = msg.args;
	const codeMatch = /^\tCode: \(?(?:async )?function\s*\w*\s*\(([^)]*)\)\s*\{/m.exec(code);
	if (codeMatch) {
		const params = codeMatch[1]
			.split(',')
			.map((i) => i.trim())
			.filter(Boolean)
			.slice(1);
		let args = '';
		if (params.length === 1 && params[0].startsWith('...')) {
			args = `\n\t\tconst ${params[0].slice(3)} = [...msg.args];`;
		} else if (params.length > 0) {
			const named = params.filter((i) => !i.startsWith('...')).map((i) => i.replace(/\s*=.*$/, ''));
			const rest = params.find((i) => i.startsWith('...'));
			args = `\n\t\tconst [${[...named, ...(rest ? [rest] : [])].join(', ')}] = msg.args;`;
		}
		code = code.slice(0, codeMatch.index) + `\texecute: async (client, msg) => {${args}` + code.slice(codeMatch.index + codeMatch[0].length);

		// Ende des Code-Blocks: erste Zeile "\t})," oder "\t}," nach dem Anfang -> "\t},"
		const after = codeMatch.index;
		const closeRegex = /^\t\}\)?,?$/m;
		const rest = code.slice(after);
		const closeMatch = closeRegex.exec(rest);
		if (closeMatch) {
			const position = after + closeMatch.index;
			code = code.slice(0, position) + '\t},' + code.slice(position + closeMatch[0].length);
		}
	}

	return code
		.replace(/^\tName:/m, '\tname:')
		.replace(/^\tAliases: null,?\n/m, '')
		.replace(/^\tAliases: \[\],?\n/m, '')
		.replace(/^\tAliases:/m, '\taliases:')
		.replace(/^\tCooldown:/m, '\tcooldown:')
		.replace(/^\tDescription:/m, '\tdescription:')
		.replace(/^\tUsage:/m, '\tusage:')
		.replace(/^\tFlags: \[\],?\n/m, '')
		.replace(/^\tFlags:/m, '\tflags:')
		.replace(/^\tParams: \[\],?\n/m, '')
		.replace(/^\tParams:/m, '\tparams:')
		.replace(/^\tWhitelist_Response: null,?\n/m, '')
		.replace(/^\tWhitelist_Response:/m, '\twhitelistResponse:')
		.replace(/^\tDynamic_Description: null,?\n?/m, '')
		.replace(/^\tDynamic_Description:/m, '\tdynamicDescription:')
		.replace(/\bthis\.Cooldown\b/g, 'module.exports.cooldown')
		.replace(/\breply:/g, 'text:')
		.replace(/\breplyTo: true\b/g, 'reply: true');
};

const markTodos = (code) =>
	code
		.split('\n')
		.map((line) => (/core\.(Query|Cache|Got)|\bsb\.|TODO_PORT|_TODO\(/.test(line) && !line.includes('TODO(port)') ? `${line} // TODO(port)` : line))
		.join('\n');

const main = () => {
	const [source, target] = process.argv.slice(2);
	const absoluteTarget = path.resolve(target);
	let code = stripTypeScriptTypes(readFileSync(source, 'utf8'), { mode: 'strip' });
	code = convertImports(code, path.dirname(path.resolve(source)), absoluteTarget);
	code = convertExports(code);
	if (/commands\/[^/]+\/+index\.ts$/.test(source)) {
		code = code.replace(/^const \{ declare \} = require\([^)]*\);\n/m, '');
		code = code.replace(
			/^const \{ declare, isResultFailure \} = require\([^)]*\);\n/m,
			"const { isResultFailure } = require('../clients/modules/commands.js');\n",
		);
		code = convertCommand(code);
	}
	for (const [regex, replacement] of API_RENAMES) {
		code = code.replace(regex, replacement);
	}
	const relativeTo = (target) => {
		let result = path.relative(path.dirname(absoluteTarget), path.join(NEXT, target));
		return result.startsWith('.') ? result : `./${result}`;
	};
	if (/\bgetPermissions\(/.test(code) && !/getPermissions \} = require/.test(code)) {
		code = `const { getPermissions } = require('${relativeTo('src/clients/modules/handler')}.js');\n${code}`;
	}
	const loaderNames = ['getCommand', 'commands', 'toListed'].filter((name) => new RegExp(`\\b${name}\\b`).test(code));
	if (loaderNames.length > 0 && !/clients\/modules\/commands\.js/.test(code)) {
		code = `const { ${loaderNames.join(', ')} } = require('${relativeTo('src/clients/modules/commands')}.js');\n${code}`;
	}
	if (/\bgot(\.gql)?\(/.test(code) && !/require\([^)]*token\/got\.js/.test(code)) {
		let gotPath = path.relative(path.dirname(absoluteTarget), path.join(NEXT, 'src/token/got'));
		if (!gotPath.startsWith('.')) {
			gotPath = `./${gotPath}`;
		}
		code = `const { got } = require('${gotPath}.js');\n${code}`;
	}
	code = markTodos(code);
	mkdirSync(path.dirname(absoluteTarget), { recursive: true });
	writeFileSync(absoluteTarget, code);
};

main();
