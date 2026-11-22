// Ring-Puffer fuer rohe Hermes-Events (Statusseite, Block 9), aus sb-v2 (v2/singletons/event-feed.ts)

const MAX_ENTRIES = 300;

const entries = [];

const push = (entry) => {
	entries.unshift(entry);
	if (entries.length > MAX_ENTRIES) {
		entries.length = MAX_ENTRIES;
	}
};

const getRecent = (limit = MAX_ENTRIES) => entries.slice(0, limit);

module.exports = { push, getRecent };
