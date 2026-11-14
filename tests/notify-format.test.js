const test = require('node:test');
const assert = require('node:assert/strict');
const { formatTitleChange, formatOfflineText } = require('../src/services/notifications.js');

test('Titel-Meldung: Live-Dauer nur wenn live (ninou2, 10.11.2026)', () => {
	assert.equal(
		formatTitleChange(['zzquser'], 'zzqstreamer', 'zzq title', 'World of Warcraft', 80 * 60_000),
		'@zzquser — @zzqstreamer changed their title: " zzq title " (Category: World of Warcraft) [at ⏱1h 20min]',
	);
	assert.equal(formatTitleChange(['zzquser'], 'zzqstreamer', 'zzq title', null, null), '@zzquser — @zzqstreamer changed their title: " zzq title "');
});

test('Offline-Meldung mit @ (ninou2, 10.11.2026)', () => {
	assert.match(formatOfflineText('zzqstreamer', null, 'Zzq Game', 169 * 60_000), /^@zzqstreamer is now offline! Last game played: \[Zzq Game\]\./);
});
