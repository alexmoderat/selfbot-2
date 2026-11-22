import type { ChatClient } from '@kararty/dank-twitch-irc';

/** Nachricht, wie clients/events/PRIVMSG.js sie baut und an Commands und Module gibt */
export interface ChatMessage {
	user: { id: string; name: string; login: string; display: string; colorRaw?: string; badgesRaw?: string; color?: unknown; perms: { mod: boolean; broadcaster: boolean; vip: boolean } };
	channel: { id: string; login: string };
	id: string;
	isAction: boolean;
	raw: string;
	text: string;
	args?: string[];
	params?: Record<string, string | boolean>;
	timestamp: string;
	received: number;
	send(message: string, reply?: boolean): Promise<unknown>;
	[key: string]: unknown;
}

/** Rueckgabe eines Commands */
export interface CommandResult {
	text?: string;
	reply?: boolean;
	success?: boolean;
	[key: string]: unknown;
}

export type CommandFlag = 'confirm' | 'cooldown-notice' | 'external-input' | 'mention' | 'mod' | 'no-prefix' | 'non-nullable' | 'block' | 'opt-out' | 'owner' | 'pipe' | 'skip-banphrase' | 'whitelist';

/** Eine Datei in src/commands/ exportiert genau dieses Objekt */
export interface CommandDefinition {
	name: string;
	description?: string | null;
	usage?: string | null;
	/** Cooldown in Millisekunden */
	cooldown?: number;
	aliases?: string[];
	flags?: CommandFlag[];
	params?: unknown[];
	whitelistResponse?: string | null;
	dynamicDescription?: ((...args: unknown[]) => string) | null;
	data?: Record<string, unknown>;
	init?: (command: Command) => unknown;
	destroy?: (command: Command) => unknown;
	execute(client: ChatClient, msg: ChatMessage): Promise<CommandResult | void | null> | CommandResult | void | null;
}

/** Definition nach normalize(): alle Felder gefuellt */
export interface Command extends CommandDefinition {
	aliases: string[];
	cooldown: number;
	flags: readonly CommandFlag[];
	ready: boolean;
	data: Record<string, unknown>;
	readonly permission: 'owner' | 'mod' | 'everyone';
	toListed(): { Name: string; Aliases: string[]; Description: string | null; Usage: string | null; permission: string; noPrefix: boolean };
}

/** config.json (Pflichtfelder siehe config.js validate; der Rest ist offen) */
export interface Config {
	selfName: string;
	selfId: string;
	prefix: string;
	messageLimit: number;
	dedupeWindow: number;
	parallelMode?: boolean;
	postgres: Record<string, any>;
	redis: { host: string; port: number; db: number };
	console: { port: number };
	web?: { port?: number; [key: string]: any };
	api?: { port?: number };
	responses: Record<string, string>;
	values: Record<string, any>;
	modules: Record<'commands' | 'modules' | 'crons', { disableAll?: boolean; whitelist: string[]; blacklist: string[] }>;
	twitch?: { username: string; oauth?: string; rateLimits?: string; [key: string]: any };
	[key: string]: any;
}

/** Das globale bot: die eine TwitchBot-Instanz (main.js). Dienste sind bewusst offen typisiert. */
export interface Bot {
	Config: Config;
	Client: ChatClient;
	Commands: Map<string, Command>;
	[service: string]: any;
}
