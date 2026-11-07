const { createServer } = require('node:net');
const { Logger } = require('../misc/logger.js');
const { handler } = require('./modules/handler.js');
const Users = require('../services/users.js');

// Lokale Debug-Konsole (bisher platforms/net.ts): per TCP verbinden, bekannten Usernamen eingeben, dann Commands
// wie im Chat tippen. Lauscht NUR auf 127.0.0.1. Kein Cooldown (debug), Antworten kommen in die Konsole.
// "#channelname" waehlt einen Channel als Kontext (wie eine Nachricht dort, als Mod), "#" ohne Namen wieder PMs.
// Commands, die selbst in den Channel schreiben (afk-Ansage, pyramid, ...), schreiben dann wirklich in den Chat.

const start = (port) => {
	const server = createServer((socket) => {
		let user = null;
		let channel = null;
		const write = (text) => socket.write(`< ${text}\n> `);
		write('Connected. Select an existing username');
		socket.setEncoding('utf8');

		const handleLine = async (line) => {
			if (!line) {
				return;
			} else if (line === 'exit' || line === 'quit') {
				socket.end();
				return;
			}

			if (!user) {
				user = await Users.get(line);
				if (!user) {
					write('Unknown username provided, try again');
					return;
				}
				write("Initialized, waiting for commands. Use 'exit' or 'quit' to terminate the session, '#channel' to pick a channel");
				return;
			}

			if (line.startsWith('#')) {
				const name = line.slice(1).trim();
				channel = name ? bot.Channels.get(name) : null;
				write(name && !channel ? `Unknown channel ${name}` : `Context: ${channel ? `#${channel.name} (as mod)` : 'private messages'}`);
				return;
			}

			const msg = {
				user: {
					id: user.twitchId,
					name: user.name,
					login: user.name,
					display: user.name,
					badges: channel ? [{ set_id: 'moderator', id: '1', info: '' }] : [],
					perms: { mod: Boolean(channel), broadcaster: Boolean(channel && channel.twitchId === user.twitchId), vip: false },
				},
				channel: channel ? { id: channel.twitchId, login: channel.name } : null,
				id: null,
				text: line,
				originalText: line,
				tags: {},
				channelData: channel,
				sender: user,
				debug: true,
				privateMessage: !channel,
				get displayName() {
					return user.name;
				},
				/** Wie Supibots getBestAvailableEmote: Emote-Verfuegbarkeit wird (noch) nicht geprueft, also der Fallback */
				getBestAvailableEmote: async (emotes, fallback) => fallback,

				send: async (message) => write(message),
				whisper: async (message) => write(`(whisper) ${message}`),
			};

			const handled = await handler(msg);
			if (!handled) {
				write('(no command)');
			}
		};

		// Zeilen nacheinander abarbeiten, damit Antworten in der Reihenfolge der Eingaben kommen
		let queue = Promise.resolve();
		let buffer = '';
		socket.on('data', (chunk) => {
			buffer += chunk;
			let index;
			while ((index = buffer.indexOf('\n')) !== -1) {
				const line = buffer.slice(0, index).trim();
				buffer = buffer.slice(index + 1);
				queue = queue.then(() => handleLine(line).catch((e) => write(`error: ${e.message}`)));
			}
		});
		socket.on('error', () => socket.destroy());
	});

	return new Promise((resolve, reject) => {
		server.once('error', reject);
		server.listen(port, '127.0.0.1', () => {
			Logger.info(`[console] Debug-Konsole lauscht auf 127.0.0.1:${port}`);
			resolve(server);
		});
	});
};

module.exports = { start };
