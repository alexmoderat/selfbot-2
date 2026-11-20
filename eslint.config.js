const js = require('@eslint/js');
const globals = require('globals');

module.exports = [
	{ ignores: ['node_modules/**', '.yarn/**'] },
	js.configs.recommended,
	{
		languageOptions: {
			ecmaVersion: 'latest',
			sourceType: 'commonjs',
			globals: {
				...globals.node,
				bot: 'readonly',
			},
		},
		rules: {
			'no-unused-vars': ['warn', { args: 'none', caughtErrors: 'none' }],
			'no-control-regex': 'off',
			'no-misleading-character-class': 'off',
		},
	},
	{
		// Donts Dateien bleiben wortwoertlich; seine eigene Konfiguration (.eslintrc.yml) hatte no-unused-vars aus,
		// die uebrigen Treffer sind Donts Schreibweise und werden hier nicht verfolgt
		files: ['src/main.js', 'src/api/**', 'src/clients/**', 'src/commands/**', 'src/database/redis.js', 'src/database/postgres.js', 'src/misc/**', 'src/token/**', 'src/util/**'],
		rules: {
			'no-unused-vars': 'off',
			'no-constant-binary-expression': 'off',
			'no-useless-escape': 'off',
			'no-empty': 'off',
			'no-case-declarations': 'off',
			'no-prototype-builtins': 'off',
			'no-async-promise-executor': 'off',
		},
	},
];
