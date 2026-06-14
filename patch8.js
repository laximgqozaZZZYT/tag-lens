const fs = require('fs');

let code = fs.readFileSync('src/draw-helpers.ts', 'utf8');

// 1. Remove truncateToWidth from X axis, but skip if labels overlap
// 2. Rotate Y axis label by -90 deg and remove truncateToWidth
code = code.replace(
`	if (!skipTicks) {
		if (laid.axes) {
			if (axX) {
				if (axX.kind === "categorical" && axX.bands) {
					for (const b of axX.bands) {
						const xC = b.center * zoom + panX;
						if (xC < headerW || xC > visW) continue;
						const bwScreen = (b.end - b.start) * zoom;
						const label = truncateToWidth(ctx, b.label, bwScreen - 12);
						ctx.fillText(label, xC, headerH / 2);
					}
				} else {
					for (const t of axX.ticks || []) {
						const xC = t.pos * zoom + panX;
						if (xC < headerW || xC > visW) continue;
						ctx.fillText(t.label, xC, headerH / 2);
					}
				}
			}
			if (axY) {
				if (axY.kind === "categorical" && axY.bands) {
					for (const b of axY.bands) {
						const yC = b.center * zoom + panY;
						if (yC < headerH || yC > visH) continue;
						const bhScreen = (b.end - b.start) * zoom;
						if (bhScreen < fontPx + 4) continue; // Skip if band is vertically squished
						const label = truncateToWidth(ctx, b.label, headerW - 8);
						ctx.fillText(label, headerW / 2, yC);
					}
				} else {
					for (const t of axY.ticks || []) {
						const yC = t.pos * zoom + panY;
						if (yC < headerH || yC > visH) continue;
						ctx.fillText(t.label, headerW / 2, yC);
					}
				}
			}
		}`,
`	if (!skipTicks) {
		if (laid.axes) {
			if (axX) {
				let lastRight = -1;
				if (axX.kind === "categorical" && axX.bands) {
					for (const b of axX.bands) {
						const xC = b.center * zoom + panX;
						if (xC < headerW || xC > visW) continue;
						const w = ctx.measureText(b.label).width;
						if (xC - w / 2 < lastRight + 10) continue; // skip if overlaps
						ctx.fillText(b.label, xC, headerH / 2);
						lastRight = xC + w / 2;
					}
				} else {
					for (const t of axX.ticks || []) {
						const xC = t.pos * zoom + panX;
						if (xC < headerW || xC > visW) continue;
						const w = ctx.measureText(t.label).width;
						if (xC - w / 2 < lastRight + 10) continue;
						ctx.fillText(t.label, xC, headerH / 2);
						lastRight = xC + w / 2;
					}
				}
			}
			if (axY) {
				let lastBottom = -1;
				if (axY.kind === "categorical" && axY.bands) {
					for (const b of axY.bands) {
						const yC = b.center * zoom + panY;
						if (yC < headerH || yC > visH) continue;
						const w = ctx.measureText(b.label).width; // width of rotated text becomes its height
						if (yC - w / 2 < lastBottom + 10) continue;
						ctx.save();
						ctx.translate(headerW / 2, yC);
						ctx.rotate(-Math.PI / 2);
						ctx.fillText(b.label, 0, 0);
						ctx.restore();
						lastBottom = yC + w / 2;
					}
				} else {
					for (const t of axY.ticks || []) {
						const yC = t.pos * zoom + panY;
						if (yC < headerH || yC > visH) continue;
						const w = ctx.measureText(t.label).width;
						if (yC - w / 2 < lastBottom + 10) continue;
						ctx.save();
						ctx.translate(headerW / 2, yC);
						ctx.rotate(-Math.PI / 2);
						ctx.fillText(t.label, 0, 0);
						ctx.restore();
						lastBottom = yC + w / 2;
					}
				}
			}
		}`
);

fs.writeFileSync('src/draw-helpers.ts', code);
