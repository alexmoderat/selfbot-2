const { getPermissions } = require('../clients/modules/handler.js');
const { subcommands } = require('../util/commands/set/subcommands/index.js');

const command = {
	name: 'set',
	aliases: ['unset'],
	cooldown: { user: 5 },
	access: { channel: 0 },
	description: 'Sets/unsets certain variables within the bot. Check the extended help for full info.',
	usage: 'set <type> (value) | unset <type> (value)',
	flags: ['mention', 'pipe'],
	params: [{ name: 'from', type: 'string' }],
	execute: async ({ client, message: msg }) => {
		const [typeInput, ...args] = msg.args;
		if (!typeInput) {
			return {
				success: false,
				text: 'No type provided!',
			};
		}

		const invocation = msg.invocation === 'unset' ? 'unset' : 'set';
		const type = typeInput.toLowerCase();

		const target = subcommands.find((i) => type === i.name || i.aliases.includes(type));
		if (!target) {
			return {
				success: false,
				text: 'Invalid type provided!',
			};
		} else if (typeof target[invocation] !== 'function') {
			return {
				success: false,
				text: `You cannot ${invocation} the type ${type}!`,
			};
		}

		const permissions = getPermissions(msg);
		if (target.flags.ownerOnly && !permissions.administrator && !permissions.channelOwner) {
			return {
				success: false,
				text: `Only channel owners and administrators can work with the type "${type}"!`,
			};
		}

		if (target.parameter === 'arguments') {
			const callback = target[invocation];
			return callback ? await callback(msg, ...args) : { success: false, text: 'Invalid type provided!' };
		}

		if (invocation === 'unset' && msg.params.from && target.userSpecificUnset) {
			return await target.userSpecificUnset(msg, msg.params.from);
		}

		const callback = target[invocation];
		if (!callback) {
			return { success: false, text: 'Invalid type provided!' };
		} else if (args.length === 0) {
			return {
				success: false,
				text: 'At least one item must be provided!',
			};
		}

		let ids = args.map(Number).filter(Boolean);
		if (args[0] === 'last') {
			if (!target.getLastID) {
				return {
					success: false,
					text: `You cannot use the keyword "last" while ${invocation}ting a ${type}!`,
				};
			}

			const lastID = await target.getLastID(msg);
			if (typeof lastID !== 'number') {
				return {
					success: false,
					text: `You don't have any active ${type}s to be ${invocation}!`,
				};
			}

			ids = [lastID];
		}

		if (ids.length === 0) {
			return {
				success: false,
				text: 'No valid numeric IDs provided!',
			};
		} else if (ids.length > 1 && invocation === 'set') {
			return {
				success: false,
				text: 'Cannot set more than one item at a time!',
			};
		}

		const results = [];
		for (const id of ids) {
			if (!bot.Utils.isValidInteger(id)) {
				results.push({ id, success: false, text: 'Provided ID is not a valid number!' });
				continue;
			}

			const subResult = await callback(msg, id);
			results.push({ id, ...subResult });
		}

		if (results.length === 1) {
			return {
				success: results[0].success,
				text: results[0].text,
			};
		}

		const [success, fail] = bot.Utils.splitByCondition(results, (i) => i.success !== false);
		const successString = success.length > 0 ? `Success: ${invocation}ting IDs ${success.map((i) => i.id).join(', ')}.` : '';
		const failString = fail.length > 0 ? `Fail: ${invocation}ting IDs ${fail.map((i) => i.id).join(', ')}.` : '';

		return [successString, failString].filter(Boolean).join(' ');
	},
	dynamicDescription: (prefix) => {
		const list = subcommands
			.map((i) => {
				const names = [i.name, ...i.aliases].join(', ');
				const types = [i.set ? 'set' : '', i.unset ? 'unset' : ''].filter(Boolean).join('/');
				return `<li><code>${names}</code> (${types}) ${i.description}</li>`;
			})
			.join('');

		return [
			'Sets a variable that you can then use in other commands.',
			'',

			`<code>${prefix}set (variable) (data)</code>`,
			'Sets the variable of your choice',
			'',

			`<code>${prefix}unset (variable) (data)</code>`,
			'Unsets the variable of your choice',
			'',

			'List of variables:',
			`<ul>${list}</ul>`,
		];
	},
};

module.exports = { command };
