// Ersetzt Textstellen exakt (ohne Sonderzeichen wie "$`" in String.replace) - Hilfe fuer die Umstellung.
//   node scripts/apply-edits.js <edits.json>   ([{ file, from, to }])
const { readFileSync, writeFileSync } = require('node:fs');
const edits = JSON.parse(readFileSync(process.argv[2], 'utf8'));
for (const { file, from, to } of edits) {
	const source = readFileSync(file, 'utf8');
	const index = source.indexOf(from);
	if (index === -1) {
		throw new Error(`${file}: nicht gefunden: ${from.slice(0, 80)}`);
	}
	if (source.indexOf(from, index + 1) !== -1) {
		throw new Error(`${file}: mehrdeutig: ${from.slice(0, 80)}`);
	}
	writeFileSync(file, source.slice(0, index) + to + source.slice(index + from.length));
}
console.log(`${edits.length} Ersetzung(en)`);
