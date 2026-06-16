// F4 — shape tokens for the `shape` visual channel. Pure + DOM-free: the same
// stable category→shape mapping is used by the channel (per-node params) AND the
// on-canvas legend, so a category always gets the same glyph in both places.

export type NodeShape = "circle" | "square" | "triangle" | "diamond" | "hexagon" | "star";

// Distinguishable glyphs, ordered by visual salience. A categorical field with
// more than SHAPES.length values cycles — shape is a coarse channel by nature.
export const SHAPES: readonly NodeShape[] = ["circle", "square", "triangle", "diamond", "hexagon", "star"];

// Stable, order-independent hash so the same key always maps to the same shape
// regardless of how many other categories are present (unlike index-by-first-seen).
function hashKey(key: string): number {
	let h = 2166136261;
	for (let i = 0; i < key.length; i++) {
		h ^= key.charCodeAt(i);
		h = Math.imul(h, 16777619);
	}
	return h >>> 0;
}

export function shapeForKey(key: string): NodeShape {
	return SHAPES[hashKey(key) % SHAPES.length];
}
