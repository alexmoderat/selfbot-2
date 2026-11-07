const { promisify } = require('node:util');
const { exec } = require('node:child_process');
const path = require('node:path');

// Supibots commands/restart (ersetzt sb-v2s pull, alexmoderat 23.10.2026: "Supibot restart"). Beendet den Prozess,
// pm2 startet ihn neu. "pull" als Alias fuehrt "restart pull yarn check" aus - der Ablauf von sb-v2s pull
// (git pull, Pakete, Pruefen, Neustart); einen Build-Schritt gibt es nicht, der Bot ist Plain JavaScript.

const shell = promisify(exec);
const basePath = path.join(__dirname, '..', '..');

const restartMethods = {
	pull: {
		message: 'git pull',
		commands: [`git -C ${basePath} checkout -- yarn.lock package.json`, `git -C ${basePath} pull`],
	},
	yarn: {
		message: 'yarn',
		commands: [`cd ${basePath} && COREPACK_ENABLE_DOWNLOAD_PROMPT=0 yarn`],
	},
	check: {
		message: 'yarn check',
		commands: [`cd ${basePath} && yarn check`],
	},
};

const isMethod = (input) => Object.hasOwn(restartMethods, input);

module.exports = {
	name: 'restart',
	aliases: ['pull'],
	cooldown: 10_000,
	description: 'Restarts the bot. Optionally, also pulls git changes and/or upgrades packages via yarn.',
	usage: 'restart [pull] [yarn] [check] | pull',
	flags: ['owner'],
	whitelistResponse: 'Only available to administrators!',
	execute: async (client, msg) => {
		const commands = [...msg.args];
		const list = msg.invocation === 'pull' && commands.length === 0 ? ['pull', 'yarn', 'check'] : commands;
		for (const name of list) {
			if (!isMethod(name)) {
				return {
					success: false,
					text: `Incorrect reload command provided! Use one of: ${Object.keys(restartMethods).join(', ')}`,
				};
			}

			const method = restartMethods[name];
			await msg.send(`VisLaud 👉 ${method.message}`);
			try {
				for (const command of method.commands) {
					await shell(command);
				}
			} catch (e) {
				// Kein Neustart mit kaputtem Stand (sb-v2: npm install / Build fehlgeschlagen -> Abbruch)
				const output = e.stderr || e.message;
				return { success: false, text: `${method.message} failed: ${String(output).split('\n')[0].slice(0, 200)}` };
			}
		}

		await msg.send('Restarting...');
		setTimeout(() => process.exit(0), 1000);
		return { text: null };
	},
	dynamicDescription: (prefix) => [
		'Exits the bot process, relying on pm2 to restart it.',
		'Only usable by administrators.',
		'',
		`<code>${prefix}restart</code>`,
		'Restarts the bot via process.exit()',
		'',
		`<code>${prefix}restart pull</code> · <code>${prefix}restart yarn</code> · <code>${prefix}restart check</code>`,
		'Runs git pull / yarn / the type check first (combinable), then exits.',
		'',
		`<code>${prefix}pull</code>`,
		'Same as restart pull yarn check.',
	],
};
