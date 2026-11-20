const { answerQuestion } = require('./ask.js');

/**
 * Gespraech zu !ask fortsetzen (ninou2, 20.11.2026: "!askcontinue !askc, continue the conversation ... from the last 5min,
 * after 5min !askc will reset and not continue the conversation"). Innerhalb von 5 Minuten nach der letzten Frage desselben
 * Users kennt die KI den bisherigen Verlauf; danach ist das Gespraech zu Ende und die Frage zaehlt als neue.
 */
module.exports = {
	name: 'askcontinue',
	aliases: ['askc'],
	cooldown: 10_000,
	description: 'Continues your last ask conversation if your last question was at most 5 minutes ago, otherwise starts a fresh one.',
	usage: 'askc <question>',
	flags: ['cooldown-notice', 'no-prefix', 'external-input'],
	execute: async (client, msg) => await answerQuestion(msg, { continueChat: true }),
};
