const fs = require('fs');

let code = fs.readFileSync('src/draw-helpers.ts', 'utf8');

// 1. Fix grid headers drawing uniform lines instead of bands
code = code.replace(
`	if (!skipTicks) {
		ctx.strokeStyle = theme().overlay(0.45);
		ctx.lineWidth = 1;
		ctx.beginPath();
		for (let c = minCol; c <= maxCol + 1; c++) {
			const x = c * W * zoom + panX;
			if (x < headerW - 0.5 || x > visW + 0.5) continue;
			ctx.moveTo(x, 0);
			ctx.lineTo(x, headerH);
		}
		for (let r = minRow; r <= maxRow + 1; r++) {
			const y = r * H * zoom + panY;
			if (y < headerH - 0.5 || y > visH + 0.5) continue;
			ctx.moveTo(0, y);
			ctx.lineTo(headerW, y);
		}
		ctx.stroke();
	}`,
`	if (!skipTicks) {
		ctx.strokeStyle = theme().overlay(0.45);
		ctx.lineWidth = 1;
		ctx.beginPath();
		if (laid.axes) {
			if (axX) {
				const lines = axX.kind === "categorical" && axX.bands
					? [...axX.bands.map(b => b.start), axX.bands[axX.bands.length - 1].end]
					: axX.ticks?.map(t => t.pos) || [];
				for (const x of lines) {
					const sx = x * zoom + panX;
					if (sx < headerW - 0.5 || sx > visW + 0.5) continue;
					ctx.moveTo(sx, 0);
					ctx.lineTo(sx, headerH);
				}
			} else {
				for (let c = minCol; c <= maxCol + 1; c++) {
					const x = c * W * zoom + panX;
					if (x < headerW - 0.5 || x > visW + 0.5) continue;
					ctx.moveTo(x, 0);
					ctx.lineTo(x, headerH);
				}
			}
			if (axY) {
				const lines = axY.kind === "categorical" && axY.bands
					? [...axY.bands.map(b => b.start), axY.bands[axY.bands.length - 1].end]
					: axY.ticks?.map(t => t.pos) || [];
				for (const y of lines) {
					const sy = y * zoom + panY;
					if (sy < headerH - 0.5 || sy > visH + 0.5) continue;
					ctx.moveTo(0, sy);
					ctx.lineTo(headerW, sy);
				}
			} else {
				for (let r = minRow; r <= maxRow + 1; r++) {
					const y = r * H * zoom + panY;
					if (y < headerH - 0.5 || y > visH + 0.5) continue;
					ctx.moveTo(0, y);
					ctx.lineTo(headerW, y);
				}
			}
		} else {
			for (let c = minCol; c <= maxCol + 1; c++) {
				const x = c * W * zoom + panX;
				if (x < headerW - 0.5 || x > visW + 0.5) continue;
				ctx.moveTo(x, 0);
				ctx.lineTo(x, headerH);
			}
			for (let r = minRow; r <= maxRow + 1; r++) {
				const y = r * H * zoom + panY;
				if (y < headerH - 0.5 || y > visH + 0.5) continue;
				ctx.moveTo(0, y);
				ctx.lineTo(headerW, y);
			}
		}
		ctx.stroke();
	}`
);

// 2. Fix labels overlapping and spilling
code = code.replace(
`		if (laid.axes) {
			if (axX) {
				const ticks = axX.kind === "categorical" && axX.bands
					? axX.bands.map(b => ({ pos: b.center, label: b.label }))
					: axX.ticks || [];
				for (const t of ticks) {
					const xC = t.pos * zoom + panX;
					if (xC < headerW || xC > visW) continue;
					ctx.fillText(t.label, xC, headerH / 2);
				}
			}
			if (axY) {
				const ticks = axY.kind === "categorical" && axY.bands
					? axY.bands.map(b => ({ pos: b.center, label: b.label }))
					: axY.ticks || [];
				for (const t of ticks) {
					const yC = t.pos * zoom + panY;
					if (yC < headerH || yC > visH) continue;
					ctx.fillText(t.label, headerW / 2, yC);
				}
			}
		}`,
`		if (laid.axes) {
			if (axX) {
				if (axX.kind === "categorical" && axX.bands) {
					for (const b of axX.bands) {
						const xC = b.center * zoom + panX;
						if (xC < headerW || xC > visW) continue;
						const bwScreen = (b.end - b.start) * zoom;
						const label = truncateToWidth(b.label, bwScreen - 12, ctx);
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
						const label = truncateToWidth(b.label, headerW - 8, ctx);
						ctx.fillText(label, headerW / 2, yC);
					}
				} else {
					for (const t of axX.ticks || []) {
						const yC = t.pos * zoom + panY;
						if (yC < headerH || yC > visH) continue;
						ctx.fillText(t.label, headerW / 2, yC);
					}
				}
			}
		}`
);

fs.writeFileSync('src/draw-helpers.ts', code);
