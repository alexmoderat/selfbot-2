const LocationSubcommand = require('./location.js');
const ReminderSubcommand = require('./reminder.js');
const SuggestionSubcommand = require('./suggestion.js');

// Supibots set kennt viele weitere Typen (birthday, osrs-username, ...) - sie kommen mit ihren Features dazu
const subcommands = [LocationSubcommand, ReminderSubcommand, SuggestionSubcommand];

module.exports = { subcommands };
