const { Logger } = require('../misc/logger.js');
// Twitch-seitige Sperren von Channels, in denen der Bot ist - gemeinsamer Zustand von channel-suspension (Modul),
// ban-check (Cron) und checksuspended (Command). sb-v2 partete solche Channels per IRC; hier wird der Channel auf
// Mode "Inactive" gesetzt (keine Nachrichten, kein PubSub, kein Join-Poller) und der vorherige Mode gemerkt.

/** Gruende, die der Bot selbst verwaltet und bei Reaktivierung zuruecknimmt; manuell inaktive Channels bleiben */
const AUTO_MANAGED_REASONS = new Set(['deactivated', 'TOS', 'DMCA', 'suspended']);

const getSuspension = async (channel) => await bot.Channels.getData(channel, 'inactive');

/** Channel wegen Sperre verlassen; false, wenn er schon inaktiv war */
const suspendChannel = async (channel, reason) => {
	if (channel.mode === 'Inactive') {
		return false;
	}

	await bot.Channels.setData(channel, 'inactive', { reason, since: new Date().toISOString(), previousMode: channel.mode });
	await bot.Channels.saveProperty(channel, 'Mode', 'Inactive');
	await bot.Twitch.leaveChannel(channel).catch((e) => Logger.warn(`[suspension] Abos von #${channel.name} nicht abgebaut`, e));
	Logger.warn(`[suspension] #${channel.name} verlassen (${reason})`);
	return true;
};

/**
 * Wieder aktiv: vorherigen Mode herstellen und neu joinen; nur fuer die angegebenen Gruende (Standard: die vom Bot
 * verwalteten). "bot_banned" gibt nur das Unban-Event aus chatrooms-user-v1 frei.
 */
const reactivateChannel = async (channel, platform = bot.Twitch, reasons = AUTO_MANAGED_REASONS) => {
	const suspension = await getSuspension(channel);
	if (!suspension || !reasons.has(suspension.reason)) {
		return false;
	}

	await bot.Channels.saveProperty(channel, 'Mode', suspension.previousMode);
	await bot.Channels.setData(channel, 'inactive', null);
	await platform.joinChannel(channel);
	Logger.info(`[suspension] #${channel.name} wieder aktiv, Mode ${suspension.previousMode}`);
	return true;
};

/** Alle vom Bot wegen Sperre verlassenen Channels */
const listSuspended = async (platform) => {
	const result = [];
	for (const channel of bot.Channels.all()) {
		if (channel.mode !== 'Inactive') {
			continue;
		}

		const suspension = await getSuspension(channel);
		if (suspension && AUTO_MANAGED_REASONS.has(suspension.reason)) {
			result.push({ channel, suspension });
		}
	}

	return result;
};

module.exports = { AUTO_MANAGED_REASONS, getSuspension, suspendChannel, reactivateChannel, listSuspended };
