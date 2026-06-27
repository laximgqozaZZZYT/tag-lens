import type { SizedNode } from "./layout";


export function isSubset<T>(small: Set<T>, big: Set<T>): boolean {
	if (small.size > big.size) return false;
	for (const v of small) if (!big.has(v)) return false;
	return true;
}

// Shelf-pack cards into rows until the row would exceed a sqrt-area
// target, then wrap. Returned positions are top-left-relative card
// CENTRES (i.e. each position is the centre of one card).
export function shelfPack(
	sizes: SizedNode[],
	gap: number,
): {
	positions: { x: number; y: number }[];
	width: number;
	height: number;
} {
	if (sizes.length === 0) return { positions: [], width: 32, height: 24 };
	let totalArea = 0;
	let maxCardW = 0;
	for (const s of sizes) {
		totalArea += (s.width + gap) * (s.height + gap);
		if (s.width > maxCardW) maxCardW = s.width;
	}
	const targetW = Math.max(
		maxCardW,
		Math.ceil(Math.sqrt(totalArea) * 1.15),
	);
	const positions: { x: number; y: number }[] = new Array<{ x: number; y: number }>(sizes.length);
	let curX = 0;
	let curY = 0;
	let rowH = 0;
	let maxEnd = 0;
	for (let i = 0; i < sizes.length; i++) {
		const s = sizes[i];
		if (curX > 0 && curX + s.width > targetW) {
			curY += rowH + gap;
			curX = 0;
			rowH = 0;
		}
		positions[i] = { x: curX + s.width / 2, y: curY + s.height / 2 };
		curX += s.width + gap;
		if (s.height > rowH) rowH = s.height;
		if (curX - gap > maxEnd) maxEnd = curX - gap;
	}
	return { positions, width: maxEnd, height: curY + rowH };
}
