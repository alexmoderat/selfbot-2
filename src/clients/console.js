const { createServer } = require('node:net');
const { Logger } = require('../misc/logger.js');
const { handler } = require('./modules/handler.js');
const Users = require('../services/users.js');

// Lokale Debug-Konsole (bisher platforms/net.ts): per TCP verbinden, bekannten Usernamen eingeben, dann Commands
// wie im Chat tippen. Lauscht NUR auf 127.0.0.1. Kein Cooldown (debug), Antworten kommen in die Konsole.

const start = (port) => {
	const server = createServer((socket) => {
		let user = null;
		const write = (text) => socket.write(`< ${text}\n> `);
		write('Connected. Select an existing username');
		socket.setEncoding('utf8');

		const handleLine = async (line) => {
			if (!line) {
				return;
			}
			else if (line === 'exit' || line === 'quit') {
				socket.end();
				return;
			}

			if (!user) {
				user = await Users.get(line);
				if (!user) {
					write('Unknown username provided, try again');
					return;
				}
				write("Initialized, waiting for commands. Use 'exit' or 'quit' to terminate the session");
				return;
			}

			const msg = {
				user: { id: user.twitchId, name: user.name, login: user.name, display: user.name, badges: [], perms: { mod: false, broadcaster: false, vip: false } },
				channel: null,
				id: null,
				text: line,
				originalText: line,
				tags: {},
				channelData: null,
				sender: user,
				debug: true,
				privateMessage: true,
				get displayName() {
					return user.name;
				},
				send: async (message) => write(message),
				whisper: async (message) => write(message),
			};

			const handled = await handler(msg);
			if (!handled) {
				write('(no command)');
			}
		};

		let buffer = '';
		socket.on('data', (chunk) => {
			buffer += chunk;
			let index;
			while ((index = buffer.indexOf('\n')) !== -1) {
				const line = buffer.slice(0, index).trim();
				buffer = buffer.slice(index + 1);
				handleLine(line).catch((e) => write(`error: ${e.message}`));
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
