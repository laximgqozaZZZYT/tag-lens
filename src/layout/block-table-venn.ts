// Component-Based Euler/Venn node placement for the bubblesets view mode.
//
// When tags genuinely intersect, a 1-D "strip" placement cannot realise the full 
// Euler layout (A, B, C, A∩B, A∩C, B∩C, A∩B∩C). This module groups candidate 
// tags into connected components. For every component, it enforces a 3-way Euler 
// diagram using the 3 largest tags (A, B, C), mapping their intersections onto a 
// 3×3 (+ a spanning bottom row) block table so that each tag's axis-aligned 
// bounding box correctly encompasses its intersections without swallowing unrelated nodes:
//
//             col0        col1(shared)   col2
//   row0      A-only       A∩B            B-only
//   row1      A∩C          A∩B∩C          B∩C
//   row2      C-only (spans col0..col2 along the bottom)
//
// Components are laid out sequentially along the X-axis, ensuring independent
// clusters never interfere.

export interface BTVNode {
	id: string;
	x: number;
	y: number;
	memberships: string[];
}

export interface BTVOptions {
	slotW: number;
	slotH: number;
	/** Returns true when `wrapper` is a base-enclosure wrapper of `view`. */
	isEnclosureOf: (wrapper: string, view: string) => boolean;
	/** Member-id set per tag. */
	tagMembers: Map<string, Set<string>>;
	/** Total distinct node count in the figure. */
	totalNodes: number;
	noneBucket: string;
}

export interface BTVResult {
	/** New centre coordinates for every node, keyed by id. */
	positions: Map<string, { x: number; y: number }>;
}

function nodeSignature(
	memberships: string[],
	isEnclosureOf: (wrapper: string, view: string) => boolean,
	noneBucket: string,
): string[] {
	const raw = memberships.length > 0 ? [...new Set(memberships)].sort() : [noneBucket];
	const sig = raw.filter((t) => !raw.some((t2) => t2 !== t && isEnclosureOf(t, t2)));
	return sig.length > 0 ? sig : raw;
}

interface Block {
	nodes: BTVNode[];
	cols: number; // grid columns occupied
	rows: number; // grid rows occupied
}

function makeBlock(nodes: BTVNode[], aspect = 1): Block {
	if (nodes.length === 0) return { nodes, cols: 1, rows: 1 };
	// `aspect` = slotH/slotW; <1 for wide cards. Fewer columns ∝ sqrt(aspect)
	// keeps each block roughly PIXEL-square rather than cell-square.
	const cols = Math.max(1, Math.round(Math.sqrt(nodes.length * aspect)));
	const rows = Math.max(1, Math.ceil(nodes.length / cols));
	return { nodes, cols, rows };
}

/**
 * Component-based Euler Layout orchestrator.
 * Partitions the graph into independent connected components of candidate tags.
 * For each component, forces a strict 3x3 block-table Venn layout using the
 * largest 3 tags (padding if <3).
 * Outer nodes and tags outside the top-3 are placed neatly to the right of each component.
 */
export function componentEulerLayout(allNodes: BTVNode[], opts: BTVOptions): BTVResult {
	const { tagMembers, totalNodes, isEnclosureOf, noneBucket } = opts;
	const tags = [...tagMembers.keys()].filter((t) => t !== noneBucket);

	const isSupersetOf = (a: string, b: string): boolean => {
		const sa = tagMembers.get(a);
		const sb = tagMembers.get(b);
		if (!sa || !sb) return false;
		if (sa.size < sb.size) return false;
		for (const id of sb) if (!sa.has(id)) return false;
		return true;
	};

	// 1. Identify Candidates
	const candidates = tags.filter((t) => {
		// Drop universal tags (contain every node).
		if ((tagMembers.get(t)?.size ?? 0) >= totalNodes) return false;
		// Drop tags that are laminar w.r.t. ANY other tag (subset, superset, or
		// base-enclosure wrapper relation) — those are containment, not
		// cross-cutting intersection, and are handled by the box-follow forest.
		for (const o of tags) {
			if (o === t) continue;
			if (isEnclosureOf(t, o) || isEnclosureOf(o, t)) return false;
			if (isSupersetOf(t, o) || isSupersetOf(o, t)) return false;
		}
		return true;
	});

	// 2. Connected Components
	const shares = (x: string, y: string): boolean => {
		const sx = tagMembers.get(x)!;
		const sy = tagMembers.get(y)!;
		const [small, large] = sx.size <= sy.size ? [sx, sy] : [sy, sx];
		for (const id of small) if (large.has(id)) return true;
		return false;
	};

	const adj = new Map<string, string[]>();
	for (const c of candidates) adj.set(c, []);
	for (let i = 0; i < candidates.length; i++) {
		for (let j = i + 1; j < candidates.length; j++) {
			if (shares(candidates[i], candidates[j])) {
				adj.get(candidates[i])!.push(candidates[j]);
				adj.get(candidates[j])!.push(candidates[i]);
			}
		}
	}

	const visited = new Set<string>();
	const components: string[][] = [];
	for (const c of candidates) {
		if (visited.has(c)) continue;
		const comp: string[] = [];
		const q = [c];
		visited.add(c);
		while (q.length > 0) {
			const curr = q.shift()!;
			comp.push(curr);
			for (const nxt of adj.get(curr)!) {
				if (!visited.has(nxt)) {
					visited.add(nxt);
					q.push(nxt);
				}
			}
		}
		// Sort tags within component by member count descending to pick top 3
		comp.sort((a, b) => (tagMembers.get(b)?.size ?? 0) - (tagMembers.get(a)?.size ?? 0));
		components.push(comp);
	}

	// 3. Build LAYOUT UNITS (each component's 3×3 Venn table, plus one block per
	//    outside-signature bucket), each rendered into a LOCAL position map at
	//    origin (0,0) so we can measure its (w,h) cell footprint…
	const { slotW, slotH } = opts;
	const cellOf = (p: { x: number; y: number }) => ({
		col: Math.round(p.x / slotW - 0.5),
		row: Math.round(p.y / slotH - 0.5),
	});
	const measure = (local: Map<string, { x: number; y: number }>) => {
		let wCells = 1, hCells = 1;
		for (const p of local.values()) {
			const { col, row } = cellOf(p);
			wCells = Math.max(wCells, col + 1);
			hCells = Math.max(hCells, row + 1);
		}
		return { wCells, hCells };
	};

	interface Unit { positions: Map<string, { x: number; y: number }>; wCells: number; hCells: number; }
	const units: Unit[] = [];
	const placedNodes = new Set<string>();

	for (const comp of components) {
		const compNodes = allNodes.filter(n => {
			if (placedNodes.has(n.id)) return false;
			const inComp = n.memberships.some(t => comp.includes(t));
			if (inComp) placedNodes.add(n.id);
			return inComp;
		});
		// Enforce N=3 layout: take top 3 tags, pad if necessary.
		const topTags = comp.slice(0, 3);
		while (topTags.length < 3) topTags.push(noneBucket);
		const [A, B, C] = topTags.sort();
		const local = new Map<string, { x: number; y: number }>();
		blockTableVennCore(compNodes, A, B, C, opts, local, 0);
		const { wCells, hCells } = measure(local);
		units.push({ positions: local, wCells, hCells });
	}

	// Outside nodes (belong to NO candidate tag) → one near-square block per signature.
	const outsideNodes = allNodes.filter(n => !placedNodes.has(n.id));
	const outsideBySig = new Map<string, BTVNode[]>();
	for (const n of outsideNodes) {
		const sig = nodeSignature(n.memberships, opts.isEnclosureOf, opts.noneBucket).join("|");
		let arr = outsideBySig.get(sig);
		if (!arr) { arr = []; outsideBySig.set(sig, arr); }
		arr.push(n);
	}
	for (const sig of [...outsideBySig.keys()].sort()) {
		const arr = outsideBySig.get(sig)!;
		// Aspect-correct columns so a bucket is pixel-square, not cell-square.
		const cols = Math.max(1, Math.round(Math.sqrt(arr.length * slotH / slotW)));
		const local = new Map<string, { x: number; y: number }>();
		arr.forEach((n, idx) => {
			local.set(n.id, {
				x: ((idx % cols) + 0.5) * slotW,
				y: (Math.floor(idx / cols) + 0.5) * slotH,
			});
		});
		const { wCells, hCells } = measure(local);
		units.push({ positions: local, wCells, hCells });
	}

	// 4. Shelf-pack the units into a ROUGHLY SQUARE arrangement (fixes the
	//    horizontal-strip bug: previously every unit was appended in one row).
	//    Target row width ≈ sqrt(total area); wrap to a new row when exceeded.
	const positions = new Map<string, { x: number; y: number }>();
	const totalArea = units.reduce((s, u) => s + u.wCells * u.hCells, 0);
	// Aspect-correct the target column count: cards are wide (slotW ≫ slotH), so a
	// cell-square block is pixel-WIDE. Fewer columns (∝ sqrt(slotH/slotW)) makes
	// the PIXEL aspect of the whole figure roughly square.
	const targetW = Math.max(1, Math.round(Math.sqrt(totalArea * slotH / slotW)));
	// Gap between units must exceed the box-follow margin so a tag box (its
	// members' bbox grown ~1 cell + an outward grid-snap of up to ~1 more) can
	// never reach a NON-member card in the neighbouring unit. 2 cells was on the
	// boundary (caught by the invariant test); 4 clears both sides.
	const GAP = 4;
	let curX = 0, curY = 0, rowH = 0;
	for (const u of units) {
		if (curX > 0 && curX + u.wCells > targetW) {
			curX = 0;
			curY += rowH + GAP;
			rowH = 0;
		}
		for (const [id, p] of u.positions) {
			positions.set(id, { x: p.x + curX * slotW, y: p.y + curY * slotH });
		}
		curX += u.wCells + GAP;
		rowH = Math.max(rowH, u.hCells);
	}

	return { positions };
}

/**
 * Lays out the given nodes into the 3x3 Venn grid for tags A, B, C, shifted by colOffset.
 * Nodes that do not belong to A, B, or C are laid out in a strip to the right.
 * Writes coordinates directly into `outPositions` and returns the number of columns used.
 */
function blockTableVennCore(
	nodes: BTVNode[],
	A: string,
	B: string,
	C: string,
	opts: BTVOptions,
	outPositions: Map<string, { x: number; y: number }>,
	colOffset: number
): { colsUsed: number } {
	const inA = opts.tagMembers.get(A) ?? new Set();
	const inB = opts.tagMembers.get(B) ?? new Set();
	const inC = opts.tagMembers.get(C) ?? new Set();

	const regions: Record<string, BTVNode[]> = {
		A: [], B: [], C: [],
		AB: [], AC: [], BC: [], ABC: [],
	};
	const outsideBySig = new Map<string, BTVNode[]>();

	for (const n of nodes) {
		const a = inA.has(n.id);
		const b = inB.has(n.id);
		const c = inC.has(n.id);
		if (a || b || c) {
			const key = `${a ? "A" : ""}${b ? "B" : ""}${c ? "C" : ""}`;
			regions[key].push(n);
		} else {
			const sig = nodeSignature(n.memberships, opts.isEnclosureOf, opts.noneBucket).join("|");
			let arr = outsideBySig.get(sig);
			if (!arr) {
				arr = [];
				outsideBySig.set(sig, arr);
			}
			arr.push(n);
		}
	}

	const aspect = opts.slotH / opts.slotW;
	const bA = makeBlock(regions.A, aspect);
	const bB = makeBlock(regions.B, aspect);
	const bC = makeBlock(regions.C, aspect);
	const bAB = makeBlock(regions.AB, aspect);
	const bAC = makeBlock(regions.AC, aspect);
	const bBC = makeBlock(regions.BC, aspect);
	const bABC = makeBlock(regions.ABC, aspect);

	// Column widths: col0 = max(A, A∩C) width; col1 = max(A∩B, A∩B∩C);
	//                col2 = max(B, B∩C).
	const col0W = Math.max(bA.cols, bAC.cols);
	const col1W = Math.max(bAB.cols, bABC.cols);
	const col2W = Math.max(bB.cols, bBC.cols);

	// Row heights for the 3-row table.
	//   row0 = max(A, A∩B, B); row1 = max(A∩C, A∩B∩C, B∩C); row2 = C-only.
	const row0H = Math.max(bA.rows, bAB.rows, bB.rows);
	const row1H = Math.max(bAC.rows, bABC.rows, bBC.rows);
	const row2H = bC.rows;

	const GAP_X = 3;
	const GAP_Y = 4;

	const col0X = colOffset;
	const col1X = col0X + col0W + GAP_X;
	const col2X = col1X + col1W + GAP_X;
	const tableCols = col2X + col2W - colOffset;

	const row0Y = 0;
	const row1Y = row0Y + row0H + GAP_Y;
	const row2Y = row1Y + row1H + GAP_Y;

	const placeBlock = (blk: Block, colX: number, rowY: number): void => {
		blk.nodes.forEach((n, idx) => {
			const dcol = idx % blk.cols;
			const drow = Math.floor(idx / blk.cols);
			const col = colX + dcol;
			const row = rowY + drow;
			outPositions.set(n.id, {
				x: (col + 0.5) * opts.slotW,
				y: (row + 0.5) * opts.slotH,
			});
		});
	};

	placeBlock(bA, col0X, row0Y);
	placeBlock(bAB, col1X, row0Y);
	placeBlock(bB, col2X, row0Y);
	placeBlock(bAC, col0X, row1Y);
	placeBlock(bABC, col1X, row1Y);
	placeBlock(bBC, col2X, row1Y);

	const bCWide: Block = { nodes: bC.nodes, cols: Math.max(1, Math.min(tableCols, bC.nodes.length || 1)), rows: 0 };
	if (bC.nodes.length > 0) {
		bCWide.cols = Math.min(tableCols, Math.max(1, Math.ceil(Math.sqrt(bC.nodes.length))));
		placeBlock({ nodes: bC.nodes, cols: bCWide.cols, rows: 0 }, col0X, row2Y);
	}

	let stripCol = col0X + tableCols + 1;
	for (const sig of [...outsideBySig.keys()].sort()) {
		const arr = outsideBySig.get(sig)!;
		const cols = Math.max(1, Math.ceil(Math.sqrt(arr.length)));
		arr.forEach((n, idx) => {
			const col = stripCol + (idx % cols);
			const row = Math.floor(idx / cols);
			outPositions.set(n.id, {
				x: (col + 0.5) * opts.slotW,
				y: (row + 0.5) * opts.slotH,
			});
		});
		stripCol += cols + 1;
	}

	return { colsUsed: stripCol - colOffset };
}
