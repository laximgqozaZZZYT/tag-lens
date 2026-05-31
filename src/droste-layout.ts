import type { GraphData, GraphNode } from "./types";
import { NONE_BUCKET } from "./types";

// Print Gallery source plane (spec §2/§3, FINAL). We do NOT hand-build tiles. We
// reorder the BubbleSets-style geometry into the ①②③④ containment-zoom order from
// the focus node N, as a continuous SOURCE PLANE (cards + group enclosure frames in
// world coords). draw-droste wraps this plane onto ζ and warps it with exp(γζ).
//
// T = the focus node N's membership cluster-key set (the GROUP_BY intersection).
//   ① node N
//   ② nodes whose membership set EXACTLY equals T (incl. N)
//   ③ those nodes as ONE T-enclosure frame
//   ④ groups whose signature is a PROPER SUBSET of T (zoom-out)
//   ⑤ UNRELATED notes — signature NOT a subset of T (supersets, partial overlaps,
//      disjoint tags, or untagged). Drawn OUTSIDE the ①②③④ core by the renderer.
export interface DrosteShape {
	id: string;
	role: 1 | 2 | 3 | 4 | 5;
	kind: "card" | "frame"; // card = node (filled); frame = group enclosure (stroked)
	label: string;
	hueKey: string;
	// Source-plane axis-aligned rect (world coords).
	x0: number;
	y0: number;
	x1: number;
	y1: number;
	// For ④ frames: the nodes belonging to this subset group (its exact-signature
	// notes) — EXCLUDING ① N / ② T-exact (those have signature T, not a subset).
	// Drawn as small squares inside the ④ enclosure.
	members?: { id: string; label: string; hueKey: string }[];
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
	const sigInfo = new Map<string, { keys: string[]; members: GraphNode[] }>();
	for (const n of nodes) {
		const keys = [...n.memberships].sort();
		const subset = keys.length < T.size && keys.every((k) => T.has(k)); // proper ⊊ T
		if (!subset) continue;
		const sig = keys.join("");
		const e = sigInfo.get(sig);
		if (e) e.members.push(n);
		else sigInfo.set(sig, { keys, members: [n] });
	}
	let subsetSigs = [...sigInfo.entries()].sort((a, b) =>
		b[1].keys.length - a[1].keys.length || b[1].members.length - a[1].members.length,
	);
	const overflow = subsetSigs.length > cap;
	if (overflow) subsetSigs = subsetSigs.slice(0, cap - 1);

	// Build the bands as separate item lists.
	type Item = { id: string; role: 1 | 2 | 3 | 4 | 5; kind: "card" | "frame"; label: string; hueKey: string; members?: { id: string; label: string; hueKey: string }[] };
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
		// This subset group's OWN notes (excludes ① N / ② T-exact: different signature).
		members: info.members.slice(0, cap).map((nd) => ({ id: nd.id, label: nd.label, hueKey: nd.memberships[0] ?? nd.id })),
	}));
	if (overflow) band4.push({ id: "__more", role: 4, kind: "frame", label: `+${sigInfo.size - (cap - 1)}`, hueKey: "more" });

	// ⑤ UNRELATED notes: signature is NOT a subset of T (at least one tag outside T),
	// or untagged. These have no containment relation to N, so they sit outside ①②③④.
	// NOT capped here — ALL of them are emitted; the renderer tiles as many as fit in
	// the outer region and shows a "+N" marker for any remainder.
	const unrelated = nodes.filter((n) => {
		const keys = [...n.memberships];
		return keys.length > 0 && !keys.every((k) => T.has(k));
	});
	const band5: Item[] = unrelated.map((nd) => ({
		id: nd.id, role: 5 as const, kind: "card" as const, label: nd.label, hueKey: nd.memberships[0] ?? nd.id,
	}));

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
	placeRing(band4, 3); // ④
	placeRing(band5, 4); // ⑤ unrelated (rendered outside the core)

	return { shapes, bbox: { minX: 0, minY: 0, maxX: WT, maxY: 5 * HB }, focusId };
}

// Test/inspection helper: the ①②③④ shapes grouped by role (data correctness).
const tagsOf = (n: GraphNode): Set<string> => new Set(n.memberships.filter((m) => m !== NONE_BUCKET));

function intersectionSize(a: Set<string>, b: Set<string>): number {
	let c = 0;
	for (const x of a) if (b.has(x)) c++;
	return c;
}

// Focus VISITING ORDER for the Droste zoom-tunnel. From focus0, repeatedly pick the
// unvisited note that shares the MOST tags with the current focus (ties → id asc);
// when nothing unvisited shares a tag, take the next unvisited note in id order. This
// is deterministic and reaches EVERY node, so zooming alone walks the whole vault.
export function buildDrosteSeq(data: GraphData, focus0: string, cap: number): string[] {
	const nodes = data.nodes;
	if (nodes.length === 0) return [];
	const order = nodes.map((n) => n.id).sort();
	const tags = new Map<string, Set<string>>(nodes.map((n) => [n.id, tagsOf(n)]));
	const visited = new Set<string>();
	const seq: string[] = [];
	let f = nodes.some((n) => n.id === focus0) ? focus0 : order[0];
	const limit = Math.min(Math.max(1, cap), nodes.length);
	while (f && seq.length < limit) {
		seq.push(f);
		visited.add(f);
		const ft = tags.get(f) ?? new Set<string>();
		let best: string | undefined;
		let bestScore = 0;
		for (const n of nodes) {
			if (visited.has(n.id)) continue;
			const s = intersectionSize(ft, tags.get(n.id) ?? new Set<string>());
			if (s > 0 && (s > bestScore || (s === bestScore && (best === undefined || n.id < best)))) {
				best = n.id;
				bestScore = s;
			}
		}
		f = best ?? order.find((id) => !visited.has(id)) ?? "";
	}
	return seq;
}

export function drosteRoles(meta: DrosteMeta): { role: number; ids: string[]; labels: string[] }[] {
	return [1, 2, 3, 4, 5].map((role) => {
		const s = meta.shapes.filter((e) => e.role === role);
		return { role, ids: s.map((e) => e.id), labels: s.map((e) => e.label) };
	});
}
