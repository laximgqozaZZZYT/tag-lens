import type { PositionedNode } from "./layout";

// Excel-style slot snap with FOOTPRINT awareness. Each card reserves
// ceil(w/slotW) × ceil(h/slotH) cells (= the full grid area it covers),
// not just one cell. Variable-sized cards (when nodeSizeMode != fixed
// scales them up) thus occupy multiple cells and never overlap their
// neighbours. Big cards process first so they grab the prime real
// estate; small ones spiral into the gaps.
//
// Mutates positionedNodes' (x, y) in place. Optionally takes an
// idToRect Map and updates the corresponding entries so downstream
// routing reads the post-snap position.
export function snapCardsToGrid(
	positionedNodes: PositionedNode[],
	slotW: number,
	slotH: number,
	idToRect?: Map<string, { x: number; y: number; w: number; h: number }>,
): void {
	const occupied = new Set<string>();
	const order = positionedNodes
		.map((_, i) => i)
		.sort((a, b) => {
			const A = positionedNodes[a];
			const B = positionedNodes[b];
			return B.width * B.height - A.width * A.height;
		});
	for (const idx of order) {
		const n = positionedNodes[idx];
		const colSpan = Math.max(1, Math.ceil(n.width / slotW));
		const rowSpan = Math.max(1, Math.ceil(n.height / slotH));
		let col = Math.floor(n.x / slotW - (colSpan - 1) / 2);
		let row = Math.floor(n.y / slotH - (rowSpan - 1) / 2);
		const isFree = (c: number, r: number): boolean => {
			for (let dc = 0; dc < colSpan; dc++) {
				for (let dr = 0; dr < rowSpan; dr++) {
					if (occupied.has(`${c + dc},${r + dr}`)) return false;
				}
			}
			return true;
		};
		if (!isFree(col, row)) {
			outer: for (let radius = 1; radius < 256; radius++) {
				for (let dc = -radius; dc <= radius; dc++) {
					for (let dr = -radius; dr <= radius; dr++) {
						if (Math.max(Math.abs(dc), Math.abs(dr)) !== radius) continue;
						if (isFree(col + dc, row + dr)) {
							col += dc;
							row += dr;
							break outer;
						}
					}
				}
			}
		}
		for (let dc = 0; dc < colSpan; dc++) {
			for (let dr = 0; dr < rowSpan; dr++) {
				occupied.add(`${col + dc},${row + dr}`);
			}
		}
		n.x = (col + colSpan / 2) * slotW;
		n.y = (row + rowSpan / 2) * slotH;
		const r = idToRect?.get(n.id);
		if (r) {
			r.x = n.x;
			r.y = n.y;
		}
	}
}
