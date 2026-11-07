const { listOrLink } = require('../misc/list-reply.js');
const { fetchTwitchUser } = require('../util/twitch/twitch-utils.js');

/**
 * Bot-Administratoren verwalten, aus sb-v2. Im selfbot ist "Administrator" Supibots User-Eigenschaft `administrator`
 * (User_Alias_Data) - der User wird ueber die Twitch-ID angelegt, damit ein Namenswechsel die Rechte nicht kostet.
 */

module.exports = {
	name: 'admin',
	cooldown: 3000,
	description: 'Manage bot admins.',
	usage: 'admin <add|remove|list> [username]',
	flags: ['owner'],
	execute: async (client, msg) => {
		const [sub, targetRaw] = msg.args;
		const action = sub?.toLowerCase();
		const target = targetRaw?.toLowerCase().replace('@', '');

		if (action === 'list') {
			const rows = await core.Query.getRecordset((rs) =>
				rs // TODO(port)
					.select('User_Alias.name AS Name')
					.from('selfbot_core', 'User_Alias_Data')
					.join({ toDatabase: 'selfbot_core', toTable: 'User_Alias', on: 'User_Alias_Data.User_Alias = User_Alias.id' })
					.where('Property = %s', 'administrator')
					.where('Value = %s', 'true')
					.orderBy('User_Alias.name ASC'),
			);

			return {
				text:
					rows.length > 0
						? `Bot admins (${rows.length}): ${await listOrLink(
								rows.map((i) => i.Name),
								'Bot admins',
							)}`
						: 'No bot admins configured.',
			};
		} else if (action !== 'add' && action !== 'remove') {
			return { text: `Usage: ${msg.prefix}${msg.invocation} add/remove/list <username>` };
		} else if (!target) {
			return { text: `Usage: ${msg.prefix}${msg.invocation} ${action} <username>` };
		}

		if (action === 'add') {
			const twitchUser = await fetchTwitchUser(target).catch(() => null);
			if (!twitchUser) {
				return { text: `${target} not found on Twitch.` };
			}

			const user = await bot.Users.getOrCreate(twitchUser.login, { twitchId: twitchUser.id });
			if ((await bot.Users.getData(user, 'administrator')) === true) {
				return { text: `${target} is already a bot admin.` };
			}

			await bot.Users.setData(user, 'administrator', true);
			return { text: `${twitchUser.login} (${twitchUser.id}) has been added as bot admin.` };
		}

		const user = await bot.Users.get(target);
		if (!user || (await bot.Users.getData(user, 'administrator')) !== true) {
			return { text: `${target} is not a bot admin.` };
		} else if (user.id === msg.sender.id) {
			return { text: "You can't remove yourself." };
		}

		await bot.Users.setData(user, 'administrator', null);
		return { text: `${target} has been removed from bot admins.` };
	},
};
