const { listOrLink } = require('../util/list-reply.js');
const { fetchTwitchUser } = require('../util/twitch/twitch-utils.js');

/**
 * Bot-Administratoren verwalten, aus sb-v2. Im selfbot ist "Administrator" Supibots User-Eigenschaft `administrator`
 * (User_Alias_Data) - der User wird ueber die Twitch-ID angelegt, damit ein Namenswechsel die Rechte nicht kostet.
 */

const command = {
	name: 'admin',
	cooldown: { user: 3 },
	access: { global: 1 },
	description: 'Manage bot admins.',
	usage: 'admin <add|remove|list> [username]',
	execute: async ({ client, message: msg }) => {
		const [sub, targetRaw] = msg.args;
		const action = sub?.toLowerCase();
		const target = targetRaw?.toLowerCase().replace('@', '');

		if (action === 'list') {
			const rows = (await bot.DB.User.find({ 'data.administrator': true }, { name: 1 }).sort({ name: 1 }).lean()).map((i) => ({ Name: i.name }));

			return rows.length > 0
						? `Bot admins (${rows.length}): ${await listOrLink(
								rows.map((i) => i.Name),
								'Bot admins',
							)}`
						: 'No bot admins configured.';
		} else if (action !== 'add' && action !== 'remove') {
			return `Usage: ${msg.prefix}${msg.invocation} add/remove/list <username>`;
		} else if (!target) {
			return `Usage: ${msg.prefix}${msg.invocation} ${action} <username>`;
		}

		if (action === 'add') {
			const twitchUser = await fetchTwitchUser(target).catch(() => null);
			if (!twitchUser) {
				return `${target} not found on Twitch.`;
			}

			const user = await bot.Users.getOrCreate(twitchUser.login, { twitchId: twitchUser.id });
			if ((await bot.Users.getData(user, 'administrator')) === true) {
				return `${target} is already a bot admin.`;
			}

			await bot.Users.setData(user, 'administrator', true);
			return `${twitchUser.login} (${twitchUser.id}) has been added as bot admin.`;
		}

		const user = await bot.Users.get(target);
		if (!user || (await bot.Users.getData(user, 'administrator')) !== true) {
			return `${target} is not a bot admin.`;
		} else if (user.id === msg.sender.id) {
			return "You can't remove yourself.";
		}

		await bot.Users.setData(user, 'administrator', null);
		return `${target} has been removed from bot admins.`;
	},
};

module.exports = { command };
