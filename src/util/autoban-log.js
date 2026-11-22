const { Logger } = require('../misc/logger.js');
/**
 * Wer welchen Autoban-Schalter wann umgelegt hat (alexmoderat, 03.11.2026, nachdem "autoban all" in #dburgers2 aus war und
 * niemand wusste warum). Schreibt nur echte Aenderungen, das Dashboard speichert sonst bei jedem Klick mit.
 */

const pad = (value) => String(value).padStart(2, '0');
/** "2026-11-07 19:30" (UTC) wie DATE_FORMAT(Changed, '%Y-%m-%d %H:%i') */
const formatChanged = (date) => `${date.getUTCFullYear()}-${pad(date.getUTCMonth() + 1)}-${pad(date.getUTCDate())} ${pad(date.getUTCHours())}:${pad(date.getUTCMinutes())}`;

const setAutobanSwitch = async (channel, property, disabled, changedBy, source) => {
	const before = bot.Channels.getData(channel, property) === true;
	await bot.Channels.setData(channel, property, disabled);
	if (before === disabled) {
		return;
	}

	Logger.warn(`[autoban-log] #${channel.name}: ${property} = ${disabled} durch ${changedBy} (${source})`);
	await bot.DB.createWithId('AutobanLog', { channel: channel.id, property, disabled, changedBy, source, changed: new Date() }).catch((e) => Logger.warn('[autoban-log] Eintrag fehlgeschlagen', e));
};

/** Letzte Aenderung { Changed_By, Source, Changed_At } oder null */
const lastAutobanChange = async (channel, property) => {
	const row = await bot.DB.AutobanLog.findOne({ channel: channel.id, property }).sort({ _id: -1 }).lean();
	return row ? { Changed_By: row.changedBy, Source: row.source, Changed_At: formatChanged(new Date(row.changed)) } : null;
};

const formatAutobanChange = (change) => (change ? `last changed by ${change.Changed_By} via ${change.Source} on ${change.Changed_At}` : 'no recorded change yet');

module.exports = { setAutobanSwitch, lastAutobanChange, formatAutobanChange };
