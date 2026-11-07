// Gemeinsame Raid-Aussetzung fuer duplicate-spam und raid-protection, aus sb-v2s duplicate-spam
// (suppressChannel/isSuppressed): ein Twitch-Raid setzt beide Module kurz aus, Copy-Paste-Raidtrains sind normal.

const RAID_SUPPRESS_DURATION = 30_000;
const suppressedUntil = new Map();

const suppressChannel = (channelId, duration = RAID_SUPPRESS_DURATION) => {
	suppressedUntil.set(channelId, Date.now() + duration);
};

const isSuppressed = (channelId) => {
	const until = suppressedUntil.get(channelId);
	return Boolean(until && Date.now() < until);
};

module.exports = { RAID_SUPPRESS_DURATION, suppressChannel, isSuppressed };
