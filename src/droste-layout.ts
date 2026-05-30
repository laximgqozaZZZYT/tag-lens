import type { GraphData, GraphNode } from "./types";
import { NONE_BUCKET, CARD_CELL_W, CARD_CELL_H } from "./types";

// Print Gallery source plane (spec §2/§3, FINAL). We do NOT hand-build tiles. We
// reorder the BubbleSets-style geometry into the ①②③④ containment-zoom order from
// the focus node N, as a continuous SOURCE PLANE (cards + group enclosure frames in
// world coords). draw-droste wraps this plane onto ζ and warps it with exp(γζ).
//
// T = the focus node N's membership cluster-key set (the GROUP_BY intersection).
//   ① v=0          : node N
//   ② [0,π/2)      : nodes whose membership set EXACTLY equals T (incl. N)
//   ③ [π/2,π)      : those nodes as ONE T-enclosure frame
//   ④ [π,3π/2)     : ③ + groups whose signature is a PROPER SUBSET of T (zoom-out)
//   ④→ [3π/2,2π)   : transition; ×k self-similar nesting (handled by the renderer)
export interface DrosteShape {
	id: string;
	role: 1 | 2 | 3 | 4;
	kind: "card" | "frame"; // card = node (filled); frame = group enclosure (stroked)
	label: string;
	hueKey: string;
	// Source-plane axis-aligned rect (world coords).
	x0: number;
	y0: number;
	x1: number;
	y1: number;
}

export interface DrosteBBox {
	minX: number;
	minY: number;
	maxX: number;
	maxY: number;
}

export interface DrosteMeta {
	shapes: DrosteShape[];
	bbox: DrosteBBox;
	focusId: string;
}

export interface DrosteLayoutOpts {
	focusId?: string;
	labels?: Map<string, string>;
	cols?: number; // cap on ② cards and ④ subset frames before "+N"
}

export const DROSTE_UBASE = 0.04; // inner u offset (tight central core)
const TWO_PI = 2 * Math.PI;

// Source(x,y) → strip ζ=(u,v). X→angle (full circle), Y→radial band; uH chosen so
// the warp stays locally isotropic (square-ish grid). Shared by renderer + hit-test.
export function drosteUV(b: DrosteBBox, x: number, y: number): { u: number; v: number } {
	const W = b.maxX - b.minX || 1;
	const H = b.maxY - b.minY || 1;
	const uH = TWO_PI * (H / W);
	return { u: DROSTE_UBASE + ((y - b.minY) / H) * uH, v: TWO_PI * ((x - b.minX) / W) };
}

// Inverse: strip (u, v∈[0,2π)) → source(x,y). For hit-testing.
export function drosteInvSource(b: DrosteBBox, u: number, v: number): { x: number; y: number } {
	const W = b.maxX - b.minX || 1;
	const H = b.maxY - b.minY || 1;
	const uH = TWO_PI * (H / W);
	return { x: b.minX + (v / TWO_PI) * W, y: b.minY + ((u - DROSTE_UBASE) / uH) * H };
}

const sigOf = (n: GraphNode): string => [...n.memberships].sort().join("");

export function layoutDroste(data: GraphData, opts: DrosteLayoutOpts = {}): DrosteMeta {
	const cap = Math.max(1, Math.floor(opts.cols ?? 8));
	const labels = opts.labels ?? new Map<string, string>();
	const clusterLabel = (k: string): string => labels.get(k) ?? k;
	const sigLabel = (keys: string[]): string => keys.map(clusterLabel).join(" ∩ ");
	const nodes = data.nodes;

	let focusId = opts.focusId && nodes.some((n) => n.id === opts.focusId) ? opts.focusId : "";
	if (!focusId) {
		const tagged = nodes.find((n) => n.memberships.some((m) => m !== NONE_BUCKET));
		focusId = (tagged ?? nodes[0])?.id ?? "";
	}
	const focusNode = nodes.find((n) => n.id === focusId);
	const empty: DrosteMeta = { shapes: [], bbox: { minX: 0, minY: 0, maxX: 1, maxY: 1 }, focusId };
	if (!focusNode) return empty;

	// T = N's membership set (drop NONE unless that's all it has).
	let tKeys = focusNode.memberships.filter((m) => m !== NONE_BUCKET);
	if (tKeys.length === 0) tKeys = [...focusNode.memberships];
	const T = new Set(tKeys);
	const Tsig = [...tKeys].sort().join("");

	// ② exact-T nodes (membership set === T), N first.
	const exact = nodes.filter((n) => sigOf(n) === Tsig);
	const exactOrdered = [focusNode, ...exact.filter((n) => n.id !== focusId)];

	// ④ proper-subset signatures present in the data, ordered |sig| desc then count desc.
	const sigInfo = new Map<string, { keys: string[]; count: number }>();
	for (const n of nodes) {
		const keys = [...n.memberships].sort();
		const subset = keys.length < T.size && keys.every((k) => T.has(k)); // proper ⊊ T
		if (!subset) continue;
		const sig = keys.join("");
		const e = sigInfo.get(sig);
		if (e) e.count++;
		else sigInfo.set(sig, { keys, count: 1 });
	}
	let subsetSigs = [...sigInfo.entries()].sort((a, b) =>
		b[1].keys.length - a[1].keys.length || b[1].count - a[1].count,
	);
	const overflow = subsetSigs.length > cap;
	if (overflow) subsetSigs = subsetSigs.slice(0, cap - 1);

	// Lay shapes left→right in ①②③④ order, one cell (W×H) per item, single row.
	const W = CARD_CELL_W;
	const H = CARD_CELL_H;
	const shapes: DrosteShape[] = [];
	let col = 0;
	const put = (id: string, role: 1 | 2 | 3 | 4, kind: "card" | "frame", label: string, hueKey: string): void => {
		shapes.push({ id, role, kind, label, hueKey, x0: col * W, y0: 0, x1: col * W + W, y1: H });
		col++;
	};

	// ① N (also the first ② card) at v=0.
	put(focusNode.id, 1, "card", focusNode.label, focusNode.memberships[0] ?? focusId);
	// ② the remaining exact-T cards.
	for (const n of exactOrdered.slice(1).slice(0, cap)) {
		put(n.id, 2, "card", n.label, n.memberships[0] ?? n.id);
	}
	// ③ the T-enclosure frame.
	put("__T", 3, "frame", sigLabel(tKeys) || "(all)", Tsig || "T");
	// ④ subset enclosure frames (broader), then "+N" if capped.
	for (const [sig, info] of subsetSigs) {
		put(`__sub_${sig}`, 4, "frame", sigLabel(info.keys), sig);
	}
	if (overflow) put("__more", 4, "frame", `+${sigInfo.size - (cap - 1)}`, "more");

	return { shapes, bbox: { minX: 0, minY: 0, maxX: Math.max(W, col * W), maxY: H }, focusId };
}

// Test/inspection helper: the ①②③④ shapes grouped by role (data correctness).
export function drosteRoles(meta: DrosteMeta): { role: number; ids: string[]; labels: string[] }[] {
	return [1, 2, 3, 4].map((role) => {
		const s = meta.shapes.filter((e) => e.role === role);
		return { role, ids: s.map((e) => e.id), labels: s.map((e) => e.label) };
	});
}
