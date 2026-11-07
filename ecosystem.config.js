// pm2: Parallelbetrieb als "selfbot-next"; nach dem Umschalten wird daraus "selfbot"
module.exports = {
	apps: [
		{
			name: 'selfbot-next',
			cwd: '/root/selfbot-next',
			script: './src/main.js',
			interpreter: '/root/.nvm/versions/node/v24.22.1/bin/node',
			node_args: '--env-file=.env --enable-experimental-regexp-engine',
			autorestart: true,
			max_restarts: 10,
			restart_delay: 10000,
		},
	],
};
