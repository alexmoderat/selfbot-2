const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const { isEnabled } = require('../src/selfbot/dont-commands.js');
const { setConfig, getConfig } = require('../src/selfbot/config.js');

const base = { ...getConfig() };
const withCommands = (commands) => ({ ...base, dont: { commands } });

describe('Dont-Commands: Freigabe ueber config.dont.commands', () => {
	it('Standard: alle aus', () => {
		setConfig(base);
		assert.equal(isEnabled('poro1', getConfig()), false);
	});
	it('disableAll sticht die Whitelist', () => {
		assert.equal(isEnabled('level', withCommands({ disableAll: true, whitelist: ['level'], blacklist: [] })), false);
	});
	it('Whitelist gibt nur die genannten frei', () => {
		const config = withCommands({ disableAll: false, whitelist: ['level'], blacklist: [] });
		assert.equal(isEnabled('level', config), true);
		assert.equal(isEnabled('poro1', { ...config, dont: { commands: { disableAll: false, whitelist: ['level'], blacklist: [] } } }), false);
	});
	it('Blacklist sperrt einzelne', () => {
		const config = withCommands({ disableAll: false, whitelist: [], blacklist: ['eval'] });
		assert.equal(isEnabled('eval', config), false);
		assert.equal(isEnabled('level', config), true);
	});
});
