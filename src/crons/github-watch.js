const { defineCron } = require('../clients/modules/timers.js');
const { got } = require('../token/got.js');
const { formatGithubEvent } = require('../misc/github-events.js');
const { sendAlert } = require('../services/moderation.js');

/**
 * Meldet neue Sterne, Forks, Issues, PRs und Releases beobachteter GitHub-Repos per Discord (alexmoderat, 12.11.2026:
 * EEVA-inc/Moltorino, kein Admin-Zugriff fuer einen Webhook -> Polling der oeffentlichen Events-API, kein Token noetig,
 * ETag-Abfragen zaehlen nicht gegen das Limit von 60/h). Erster Lauf nach dem Start setzt nur den Stand.
 * GITHUB_WATCH_REPOS: Komma-Liste "owner/repo" (leer = aus, Standard EEVA-inc/Moltorino), optional GITHUB_TOKEN. Fuer Repos mit Admin-Zugriff gibt es den Webhook (api/routes-github.js).
 */
const MAX_MESSAGES_PER_RUN = 5;
const EVENT_NAMES = {
	WatchEvent: 'star',
	ForkEvent: 'fork',
	IssuesEvent: 'issues',
	PullRequestEvent: 'pull_request',
	ReleaseEvent: 'release',
	IssueCommentEvent: 'issue_comment',
};

const repos = () =>
	(process.env.GITHUB_WATCH_REPOS ?? 'EEVA-inc/Moltorino')
		.split(',')
		.map((i) => i.trim())
		.filter((i) => /^[\w.-]+\/[\w.-]+$/.test(i));

/** Events-API-Eintrag -> Chat-Text (ueber dieselbe Formatierung wie der Webhook), null wenn uninteressant */
const formatApiEvent = (event) => {
	const name = EVENT_NAMES[event.type];
	if (!name) {
		return null;
	}
	const action = event.type === 'WatchEvent' ? 'created' : event.payload?.action;
	return formatGithubEvent(name, {
		...event.payload,
		action,
		repository: { full_name: event.repo?.name },
		sender: { login: event.actor?.login },
	});
};

/** Neue Events seit lastId, aelteste zuerst. lastId null = Erstlauf: nur den Stand merken. */
const newEvents = (events, lastId) => {
	if (lastId === null || !Array.isArray(events)) {
		return [];
	}
	return events.filter((e) => BigInt(e.id) > BigInt(lastId)).sort((a, b) => (BigInt(a.id) < BigInt(b.id) ? -1 : 1));
};

const latestId = (events, fallback) =>
	Array.isArray(events) && events.length > 0 ? events.reduce((m, e) => (BigInt(e.id) > BigInt(m) ? e.id : m), events[0].id) : fallback;

const state = new Map(); // repo -> { lastId, etag }

module.exports = defineCron({
	name: 'github-watch',
	expression: '30 */5 * * * *',
	description: 'Announces new stars, forks, issues, pull requests and releases of watched GitHub repos.',
	code: async function githubWatch() {
		for (const repo of repos()) {
			const s = state.get(repo) ?? { lastId: null, etag: null };
			const headers = { 'User-Agent': 'selfbot-github-watch', Accept: 'application/vnd.github+json' };
			if (s.etag) {
				headers['If-None-Match'] = s.etag;
			}
			if (process.env.GITHUB_TOKEN) {
				headers.Authorization = `Bearer ${process.env.GITHUB_TOKEN}`;
			}

			const response = await got('Global')({ url: `https://api.github.com/repos/${repo}/events?per_page=30`, headers, responseType: 'json' }).catch(
				() => null,
			);
			if (!response || response.statusCode === 304) {
				continue;
			} else if (!response.ok) {
				console.warn(`[github-watch] ${repo}: HTTP ${response.statusCode}`);
				continue;
			}

			const events = response.body;
			const fresh = newEvents(events, s.lastId);
			state.set(repo, { lastId: latestId(events, s.lastId ?? '0'), etag: response.headers?.etag ?? null });
			for (const text of fresh.map(formatApiEvent).filter(Boolean).slice(-MAX_MESSAGES_PER_RUN)) {
				await sendAlert(text).catch((e) => console.warn(`[github-watch] senden: ${e?.message}`));
			}
		}
	},
});

Object.assign(module.exports, { formatApiEvent, newEvents, latestId });
