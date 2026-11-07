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
];
