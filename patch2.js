const fs = require('fs');
let code = fs.readFileSync('src/axis-layout.ts', 'utf8');

// Update currentPos initialization
code = code.replace(
`		let currentPos = 0;
		const bandByKey = new Map<string, AxisBand>();`,
`		let currentPos = -cellPitch / 2;
		const bandByKey = new Map<string, AxisBand>();`);

// Update coordOf return
code = code.replace(
`			coordOf: (node) => {
				const raw = field.accessor(node, ctx);
				return raw == null ? null : (bandByKey.get(String(raw))?.center ?? null);
			},`,
`			coordOf: (node) => {
				const raw = field.accessor(node, ctx);
				const band = raw == null ? null : bandByKey.get(String(raw));
				return band ? Math.floor(band.center / cellPitch) * cellPitch : null;
			},`);

fs.writeFileSync('src/axis-layout.ts', code);
