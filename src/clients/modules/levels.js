// Rechte-Stufe je Command und Channel: ein Channel kann einen Command nur strenger stellen (everyone -> mods ->
// streamer), nie lockerer; Owner-Commands bleiben aussen vor (ninou2, 29.10.2026)

const RANK = { everyone: 0, mod: 1, streamer: 2 };

const parseLevel = (input) => {
	const value = input?.toLowerCase();
	if (!value) {
		return null;
	} else if (['everyone', 'anyone', 'all', 'everybody'].includes(value)) {
		return 'everyone';
	} else if (['mod', 'mods', 'moderator', 'moderators'].includes(value)) {
		return 'mod';
	} else if (['streamer', 'broadcaster', 'owner'].includes(value)) {
		return 'streamer';
	}
	return null;
};

const describeLevel = (level) => ({ everyone: 'everyone', mod: 'mods and the streamer', streamer: 'streamer only' })[level];

/** Was gilt: die eigene Stufe des Commands oder die strengere des Channels */
const effectiveLevel = (own, override) => (override && RANK[override] > RANK[own] ? override : own);

/** Neue Override-Tabelle; null = Stufe liegt unter der eigenen des Commands */
const applyLevel = (overrides, name, own, level) => {
	if (RANK[level] < RANK[own]) {
		return null;
	}
	const result = { ...overrides };
	if (level === own || level === 'everyone') {
		delete result[name];
	} else {
		result[name] = level;
	}
	return result;
};

const isLevelAllowed = (permissions, level) => {
	if (permissions.administrator || permissions.channelOwner || level === 'everyone') {
		return true;
	}
	return level === 'mod' && permissions.moderator;
};

module.exports = { parseLevel, describeLevel, effectiveLevel, applyLevel, isLevelAllowed };
