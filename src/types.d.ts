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

/** Rechte wie bei song-bot: global (0 = jeder, 1 = Bot-Administrator) und channel (0 = jeder, 1 = VIP, 2 = Mod, 3 = Broadcaster) */
export interface CommandAccess {
	global?: number;
	channel?: number;
}

/** Cooldown in Sekunden (je Aufrufer; Dezimalwerte erlaubt) */
export interface CommandCooldown {
	global?: number;
	channel?: number;
	user?: number;
}

/** Was execute() bekommt */
export interface CommandContext {
	client: ChatClient;
	message: ChatMessage;
	config: Config;
	isMod: boolean;
	isBroadcaster: boolean;
	isAdmin: boolean;
	channel: { id: string | null; name: string | null };
}

/** String = einfache Antwort; Objekt fuer success: false, cooldown, followUps, whisper usw. */
export type CommandReturn = string | CommandResult | void | null | undefined;

/** Jede Datei in src/commands/ exportiert `command` in dieser Form (wie song-bot) */
export interface CommandDefinition {
	name: string;
	aliases?: string[];
	description?: string | null;
	usage?: string | null;
	access: CommandAccess;
	cooldown: CommandCooldown;
	/** Zusatz zu song-bot: Verhaltens-Flags (pipe, mention, no-prefix, confirm, opt-out ...) */
	flags?: CommandFlag[];
	params?: unknown[];
	whitelistResponse?: string | null;
	dynamicDescription?: ((...args: unknown[]) => string) | null;
	data?: Record<string, unknown>;
	init?: (command: Command) => unknown;
	destroy?: (command: Command) => unknown;
	execute(context: CommandContext): Promise<CommandReturn> | CommandReturn;
}

/** Nach normalize(): Cooldown in ms, Flags aus access ergaenzt, execute(client, msg) -> { text, ... } */
export interface Command extends Omit<CommandDefinition, 'cooldown' | 'execute'> {
	aliases: string[];
	cooldown: number;
	flags: readonly CommandFlag[];
	ready: boolean;
	data: Record<string, unknown>;
	readonly permission: 'owner' | 'mod' | 'everyone';
	execute(client: ChatClient, msg: ChatMessage): Promise<CommandResult>;
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
