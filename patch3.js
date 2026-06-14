const fs = require('fs');
let code = fs.readFileSync('src/axis-layout.ts', 'utf8');

const formatLabelCode = `function formatAxisLabel(key: string): string {
	let s = key;
	if (s.startsWith("tag=") || s.startsWith("tag:")) s = s.slice(4);
	try { s = decodeURIComponent(s); } catch {}
	return s;
}
`;

if (!code.includes('formatAxisLabel')) {
    code = formatLabelCode + '\n' + code;
}

code = code.replace(
`			const label = e.key;`,
`			const label = formatAxisLabel(e.key);`);

code = code.replace(
`			// 1. Label width: roughly 8px per character + 32px padding
			const labelW = label.length * 8 + 32;`,
`			// 1. Label width: roughly 10px per character + 40px padding for safety (bold font)
			const labelW = label.length * 10 + 40;`);

code = code.replace(
`			const band: AxisBand = { key: e.key, label: e.key, start: currentPos, end: currentPos + bw, center: currentPos + bw / 2 };`,
`			const band: AxisBand = { key: e.key, label: label, start: currentPos, end: currentPos + bw, center: currentPos + bw / 2 };`);

fs.writeFileSync('src/axis-layout.ts', code);
