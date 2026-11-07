// Unsichtbare Zeichen (Leerraum-Varianten, Joiner, Braille-Leerzeichen, Tags) in Quelltexten als Escape schreiben,
// damit man sie im Code sieht. Die Liste steht bewusst als Zahlen da (Escapes wuerden beim Bearbeiten leicht zu
// echten Zeichen).
//   node scripts/escape-invisible.js <datei ...>

const { readFileSync, writeFileSync } = require('node:fs');

const RANGES = [
	[0xa0, 0xa0],
	[0xad, 0xad],
	[0x34f, 0x34f],
	[0x115f, 0x1160],
	[0x17b4, 0x17b5],
	[0x180e, 0x180e],
	[0x2000, 0x200f],
	[0x2028, 0x202f],
	[0x205f, 0x206f],
	[0x2800, 0x2800],
	[0x3000, 0x3000],
	[0x3164, 0x3164],
	[0xfeff, 0xfeff],
	[0xffa0, 0xffa0],
	[0xe0000, 0xe007f],
];

const isInvisible = (cp) => RANGES.some(([from, to]) => cp >= from && cp <= to);
const escape = (cp) => (cp > 0xffff ? `\\u{${cp.toString(16).toUpperCase()}}` : `\\u${cp.toString(16).toUpperCase().padStart(4, '0')}`);

for (const file of process.argv.slice(2)) {
	const source = readFileSync(file, 'utf8');
	let result = '';
	for (const char of source) {
		const cp = char.codePointAt(0);
		result += isInvisible(cp) ? escape(cp) : char;
	}
	if (result !== source) {
		writeFileSync(file, result);
		console.log(`${file}: escaped`);
	}
}
