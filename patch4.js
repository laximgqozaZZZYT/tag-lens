const fs = require('fs');

// 1. Fix axisLayout to put nodes on the half-lattice (cell centers)
let code = fs.readFileSync('src/axis-layout.ts', 'utf8');

code = code.replace(
`		anchorX = Math.round(anchorX / opts.cell.w) * opts.cell.w;
		anchorY = Math.round(anchorY / opts.cell.h) * opts.cell.h;

		const cols = Math.ceil(Math.sqrt(k));
		const rows = Math.ceil(k / cols);
		group.forEach((g, i) => {
			const col = i % cols;
			const row = Math.floor(i / cols);
			const ox = (col - Math.floor((cols - 1) / 2)) * opts.cell.w;
			const oy = (row - Math.floor((rows - 1) / 2)) * opts.cell.h;
			positions.set(g.node.id, { x: anchorX + ox, y: anchorY + oy });
		});`,
`		const cols = Math.ceil(Math.sqrt(k));
		const rows = Math.ceil(k / cols);
		
		const baseCol = Math.round(anchorX / opts.cell.w) - Math.floor(cols / 2);
		const baseRow = Math.round(anchorY / opts.cell.h) - Math.floor(rows / 2);

		group.forEach((g, i) => {
			const col = baseCol + (i % cols);
			const row = baseRow + Math.floor(i / cols);
			// Place node exactly in the center of the cell (half-lattice) 
			// so routeZ wires run along the integer lattice around them.
			const cx = (col + 0.5) * opts.cell.w;
			const cy = (row + 0.5) * opts.cell.h;
			positions.set(g.node.id, { x: cx, y: cy });
		});`
);
fs.writeFileSync('src/axis-layout.ts', code);

// 2. Fix E2E test to expect half-lattice coordinates instead of integer multiples
let e2e = fs.readFileSync('test/e2e-axis.mjs', 'utf8');
e2e = e2e.replace(
`      const xRem = Math.abs(n.x % slotW);
      const yRem = Math.abs(n.y % slotH);
      if (Math.min(xRem, slotW - xRem) > 0.5) return "Node X not snapped to slotW: " + n.x + " (rem " + xRem + ")";
      if (Math.min(yRem, slotH - yRem) > 0.5) return "Node Y not snapped to slotH: " + n.y + " (rem " + yRem + ")";`,
`      const xRem = Math.abs((n.x - slotW / 2) % slotW);
      const yRem = Math.abs((n.y - slotH / 2) % slotH);
      if (Math.min(xRem, slotW - xRem) > 0.5) return "Node X not snapped to slotW/2 center: " + n.x + " (rem " + xRem + ")";
      if (Math.min(yRem, slotH - yRem) > 0.5) return "Node Y not snapped to slotH/2 center: " + n.y + " (rem " + yRem + ")";`
);

// We should also check for edge overlap tests in E2E. The current E2E just checks endpoints.
// We will leave the endpoint checks alone, they should still match.
fs.writeFileSync('test/e2e-axis.mjs', e2e);
