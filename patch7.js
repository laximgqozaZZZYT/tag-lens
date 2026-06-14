const fs = require('fs');

let code = fs.readFileSync('src/draw-helpers.ts', 'utf8');

// First, find the declaration of axX and axY and remove it
code = code.replace(
`	ctx.textBaseline = "middle";
	const axX = laid.axes?.x;
	const axY = laid.axes?.y;

	if (!skipTicks) {`,
`	ctx.textBaseline = "middle";

	if (!skipTicks) {`
);

// Then add it higher up
code = code.replace(
`	const headerCellCount = (maxCol - minCol) + (maxRow - minRow);
	const skipTicks = headerCellCount > 4000;

	ctx.fillStyle = colorAlpha(theme().panelBg, 0.98);`,
`	const headerCellCount = (maxCol - minCol) + (maxRow - minRow);
	const skipTicks = headerCellCount > 4000;

	const axX = laid.axes?.x;
	const axY = laid.axes?.y;

	ctx.fillStyle = colorAlpha(theme().panelBg, 0.98);`
);

// Then fix the axX.ticks typo
code = code.replace(
`				} else {
					for (const t of axY.ticks || []) {
						const xC = t.pos * zoom + panX;
						if (xC < headerW || xC > visW) continue;
						ctx.fillText(t.label, xC, headerH / 2);
					}
				}`,
`				} else {
					for (const t of axX.ticks || []) {
						const xC = t.pos * zoom + panX;
						if (xC < headerW || xC > visW) continue;
						ctx.fillText(t.label, xC, headerH / 2);
					}
				}`);

fs.writeFileSync('src/draw-helpers.ts', code);
