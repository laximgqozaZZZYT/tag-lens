const fs = require('fs');

let code = fs.readFileSync('src/draw-helpers.ts', 'utf8');

code = code.replace(
`				} else {
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
				}`,
`				} else {
					for (const t of axY.ticks || []) {
						const yC = t.pos * zoom + panY;
						if (yC < headerH || yC > visH) continue;
						const h = fontPx;
						if (yC - h / 2 < lastBottom + 10) continue;
						ctx.fillText(t.label, headerW / 2, yC);
						lastBottom = yC + h / 2;
					}
				}`
);

fs.writeFileSync('src/draw-helpers.ts', code);
