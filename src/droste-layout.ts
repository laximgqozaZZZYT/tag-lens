import type { GraphData, GraphNode } from "./types";
import { NONE_BUCKET } from "./types";

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

	// Build the FOUR bands (spec §2) as separate item lists.
	type Item = { id: string; role: 1 | 2 | 3 | 4; kind: "card" | "frame"; label: string; hueKey: string };
	// ① N alone (NOT mixed with ② cards).
	const band1: Item[] = [
		{ id: focusNode.id, role: 1, kind: "card", label: focusNode.label, hueKey: focusNode.memberships[0] ?? focusId },
	];
	// ② T-exact notes (excluding N — N is shown in ①).
	const band2: Item[] = exactOrdered.slice(1).slice(0, cap).map((nd) => ({
		id: nd.id, role: 2, kind: "card" as const, label: nd.label, hueKey: nd.memberships[0] ?? nd.id,
	}));
	// ③ the T-enclosure (the GROUP_BY intersection of T), alone.
	const band3: Item[] = [
		{ id: "__T", role: 3, kind: "frame", label: sigLabel(tKeys) || "(all)", hueKey: Tsig || "T" },
	];
	// ④ T's proper-subset enclosures (|sig| desc), then "+N" if capped.
	const band4: Item[] = subsetSigs.map(([sig, info]) => ({
		id: `__sub_${sig}`, role: 4 as const, kind: "frame" as const, label: sigLabel(info.keys), hueKey: sig,
	}));
	if (overflow) band4.push({ id: "__more", role: 4, kind: "frame", label: `+${sigInfo.size - (cap - 1)}`, hueKey: "more" });

	// CONCENTRIC nesting (spec 2026-05-31): ① ∈ ② ∈ ③ ∈ ④. The depth is u (radial,
	// y here ⇒ drosteUV maps y→u): ① innermost band, ④ outermost. Each level's
	// elements spread over v (angle, x here ⇒ x→v, full width). After the warp
	// these become concentric rings; ④'s outer ring ×k-fits the next turn's ①.
	const WT = 800; // plane width  → v (angle): full [0, 2π)
	const HB = 150; // per-depth band height → u (radial) thickness of one level
	const shapes: DrosteShape[] = [];
	// band index 0..3 = depth ① (inner) … ④ (outer); items split the full width.
	const placeRing = (band: Item[], depth: number): void => {
		const ncol = Math.max(1, band.length);
		const wc = WT / ncol;
		band.forEach((it, col) => {
			shapes.push({ ...it, x0: col * wc, y0: depth * HB, x1: col * wc + wc, y1: depth * HB + HB });
		});
	};
	placeRing(band1, 0); // ① innermost
	placeRing(band2, 1); // ②
	placeRing(band3, 2); // ③
	placeRing(band4, 3); // ④ outermost

	return { shapes, bbox: { minX: 0, minY: 0, maxX: WT, maxY: 4 * HB }, focusId };
}

// Test/inspection helper: the ①②③④ shapes grouped by role (data correctness).
export function drosteRoles(meta: DrosteMeta): { role: number; ids: string[]; labels: string[] }[] {
	return [1, 2, 3, 4].map((role) => {
		const s = meta.shapes.filter((e) => e.role === role);
		return { role, ids: s.map((e) => e.id), labels: s.map((e) => e.label) };
	});
}
