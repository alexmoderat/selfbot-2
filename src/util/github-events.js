/**
 * GitHub-Webhook-Events -> Chat-Text (alexmoderat, 12.11.2026: Meldungen wie bei PotatBotat, z. B. fuer EEVA-inc/Moltorino).
 * null fuer alles Uninteressante (Pushes, Schliessen/Aendern von Issues, entfernte Sterne ...).
 */
const formatGithubEvent = (event, payload) => {
	const repo = payload?.repository?.full_name;
	const who = payload?.sender?.login;
	if (!repo || !who) {
		return null;
	}

	switch (event) {
		case 'star':
			return payload.action === 'created' ? `⭐ New star on '${repo}' by ${who}` : null;
		case 'fork':
			return `🍴 '${repo}' was forked by ${who}`;
		case 'issues':
			return payload.action === 'opened' ? `🐛 New issue on '${repo}' by ${who}: #${payload.issue?.number} ${payload.issue?.title}` : null;
		case 'pull_request':
			if (payload.action === 'opened') {
				return `🔀 New pull request on '${repo}' by ${who}: #${payload.pull_request?.number} ${payload.pull_request?.title}`;
			}
			return payload.action === 'closed' && payload.pull_request?.merged ? `✅ Pull request merged on '${repo}': #${payload.pull_request?.number} ${payload.pull_request?.title}` : null;
		case 'release':
			return payload.action === 'published' ? `🚀 New release on '${repo}': ${payload.release?.name || payload.release?.tag_name}` : null;
		case 'issue_comment':
			return payload.action === 'created' ? `💬 ${who} commented on '${repo}' #${payload.issue?.number}: ${payload.issue?.title}` : null;
		default:
			return null;
	}
};

module.exports = { formatGithubEvent };
