const SupiDate = require('../misc/date.js');
const unsetSuggestionSubcommand = require('../misc/commands/set/subcommands/suggestion.js');

// Wie Supibots suggest. Nicht uebernommen: das automatische Abo fuer Status-Benachrichtigungen
// (Supibots subscribe-System fehlt hier) und der Link zur Vorschlagsliste (Website kommt mit Block 9).
module.exports = {
	name: 'suggest',
	aliases: ['suggestions'],
	cooldown: 60000,
	description: 'Suggest something for alexmoderat. Every suggestion gets an ID. To remove one, use the unset command.',
	usage: 'suggest <text> [amend:ID]',
	// Zuschauer tippen "!suggest" (aus sb-v2); cooldown-notice, damit die 60s-Sperre nicht wie ein Fehler wirkt
	flags: ['mention', 'no-prefix', 'cooldown-notice', 'skip-banphrase'],
	params: [{ name: 'amend', type: 'number' }],
	execute: async (client, msg) => {
		const args = [...msg.args];
		const prefix = bot.Config.prefix;
		if (args.length === 0 || msg.invocation === 'suggestions') {
			const count = await bot.DB.Suggestion.countDocuments({ userAlias: msg.sender.id });

			return {
				success: false,
				text: bot.Utils.tag.trim`
					No suggestion text provided!
					You have made ${count ?? 0} suggestion(s) so far.
					Use ${prefix}suggest (text) to make one.
				`,
				cooldown: 5000,
			};
		}

		const text = args.join(' ');
		const row = await bot.DB.getRow('Suggestion');
		if (msg.params.amend) {
			await row.load(msg.params.amend, true);
			if (!row.loaded) {
				return {
					success: false,
					text: 'There is no suggestion with that ID!',
				};
			} else if (row.values.User_Alias !== msg.sender.id) {
				return {
					success: false,
					text: 'That suggestion was not made by you!',
				};
			}

			const date = new SupiDate().format('Y-m-d H:i:s');
			row.setValues({
				Text: `${row.values.Text}\n\n--- Amended on ${date} ---\n${text}`,
			});

			await row.save({ skipLoad: true });

			return {
				success: true,
				text: `Your suggestion ID ${row.values.ID} was succesfully amended.`,
			};
		}

		row.setValues({
			Text: text,
			User_Alias: msg.sender.id,
			Priority: 255,
		});

		await row.save({ skipLoad: false });

		return {
			success: true,
			text: `Suggestion saved, and will eventually be processed (ID ${row.values.ID}) 👍`,
		};
	},
	dynamicDescription: (prefix) => [
		'Creates a new suggestion for alexmoderat to take a look at in the near future.',
		'These should avoid jokes, memes and such - focus instead on proper issues, bug reports, questions, ideas etc.',
		'',

		`You can remove a suggestion you've created via the <code>${prefix}unset suggestion (ID)</code> command.`,
		'',

		`<code>${prefix}suggest (text)</code>`,
		'Creates a suggestion.',
		"You will provided with a tracking ID with which you can check the suggestion's progress",
		'',

		`<code>${prefix}suggest amend:(ID) (text)</code>`,
		"Amends an existing suggestion that you've made with more text.",
		'',

		`<code>${prefix}unset ${unsetSuggestionSubcommand.name} (${unsetSuggestionSubcommand.parameter})</code>`,
		unsetSuggestionSubcommand.description,
	],
};
