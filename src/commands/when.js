const { getCommand, commands } = require('../clients/modules/commands.js');
const { execFile } = require('node:child_process');
const { promisify } = require('node:util');

const { getConfig } = require('../config.js');
const { fmtDateTimeUtc } = require('../misc/date-format.js');

const run = promisify(execFile);
const { legacyRepoPath } = getConfig().values;
const OWN_REPO = `${require('node:path').join(__dirname, '..', '..')}/`;
/** Der alte selfbot (TypeScript), aus dem dieser Bot entstanden ist */
const SELFBOT_REPO = '/root/selfbot/';

/** Zeitpunkt des aeltesten Commits, der diese Datei betrifft (ISO, UTC) - "wann hinzugefuegt" */
const firstCommitDate = async (repo, relativePath) => {
	try {
		const { stdout } = await run('git', ['log', '--follow', '--format=%aI', '--', relativePath], { cwd: repo, timeout: 5000 });
		const lines = stdout.trim().split('\n').filter(Boolean);
		return lines.at(-1) ?? null;
	} catch {
		return null;
	}
};

/**
 * Wann ein Command zuerst hinzugefuegt wurde (aus sb-v2). ninou2, 15.10.2026: "!when X ... it tell you
 * when the command created and started tracking". Zuerst die sb-v2-Historie, denn dort sind die Commands
 * eigentlich entstanden - im neuen Repo waeren sonst alle "heute" hinzugefuegt.
 */
module.exports = {
	name: 'when',
	cooldown: 3000,
	description: 'Shows when a command was first added to the bot (from git history).',
	usage: 'when <command>',
	execute: async (client, msg) => {
		const [nameRaw] = msg.args;
		const query = (nameRaw ?? '').trim().toLowerCase().replace(/^!/, '');
		const command = getCommand(query);
		if (!command) {
			return { text: `@${msg.displayName}, no command named "${nameRaw ?? ''}" found.` };
		}

		const legacyDate = legacyRepoPath ? await firstCommitDate(legacyRepoPath, `v2/commands/${command.Name}/index.ts`) : null;

		// Reihenfolge: sb-v2, alter selfbot (TypeScript), dieser Bot
		const date =
			legacyDate ??
			(await firstCommitDate(SELFBOT_REPO, `commands/${command.Name}/index.ts`)) ??
			(await firstCommitDate(OWN_REPO, `src/commands/${command.Name}.js`));
		if (!date) {
			return { text: `@${msg.displayName}, couldn't determine when !${command.Name} was added (no git history found for it).` };
		}

		return { text: `@${msg.displayName}, !${command.Name} was first added on ${fmtDateTimeUtc(date)}.` };
	},
};
