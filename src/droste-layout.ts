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
	// For ④ frames: the nodes belonging to this subset group (its exact-signature
	// notes) — EXCLUDING ① N / ② T-exact (those have signature T, not a subset).
	// Drawn as small squares inside the ④ enclosure.
	members?: { id: string; label: string; hueKey: string }[];
	// For ④ frames: the group's sorted tag keys, so the renderer can build the
	// subset containment order (S ⊊ S′ ⇒ nest; incomparable ⇒ never overlap).
	keys?: string[];
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
	type Item = { id: string; role: 1 | 2 | 3 | 4; kind: "card" | "frame"; label: string; hueKey: string; members?: { id: string; label: string; hueKey: string }[]; keys?: string[] };
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
		keys: info.keys,
		// This subset group's OWN notes (excludes ① N / ② T-exact: different signature).
		members: info.members.slice(0, cap).map((nd) => ({ id: nd.id, label: nd.label, hueKey: nd.memberships[0] ?? nd.id })),
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

// ============================================================================
// Icon Gallery (spec 2026-06-01). Per node N, an "icon diagram":
//   ① N (centre) ∈ ② sig(N) set + members ∈ ③ direct-superset sets + members ∈ …
// generalising one tag outward per level until single-tag sets. All nodes' icons
// are tiled in a grid. Icons are built ON DEMAND (per visible cell) from the index.
// ============================================================================

const SEP = "\u0001"; // signature key joiner (control char — cannot appear in tag keys)
const keysOf = (n: GraphNode): string[] => {
	const k = n.memberships.filter((m) => m !== NONE_BUCKET).sort();
	return k.length ? k : [...n.memberships].sort();
};

export interface GalleryCell { id: string; label: string; col: number; row: number; }
export interface DrosteGallery {
	cells: GalleryCell[];
	cols: number;
	rows: number;
	// On-demand index for buildIcon():
	nodeKeys: Map<string, string[]>;            // id → sorted tag keys
	nodeLabel: Map<string, string>;             // id → display label
	labels: Map<string, string>;                // cluster-key → human label
	links: Map<string, string[]>;               // id → ids it links TO (outgoing)
	backlinks: Map<string, string[]>;           // id → ids that link to it (incoming)
}

export interface IconSet { keys: string[]; label: string; members: { id: string; label: string }[]; overflow: number; hue?: number; }
export interface IconLevel { n: number; sets: IconSet[]; kind?: "tag" | "link"; } // n: 2=②, 3=③₁, … ; ⑤ = kind "link"
export interface IconDiagram { focusId: string; focusLabel: string; tKeys: string[]; levels: IconLevel[]; }

// Build the gallery index over the FULL graph. Cheap: one pass to bucket nodes by
// signature + a grid placement, plus link/backlink adjacency. Icon trees built later.
export function buildGallery(data: GraphData, labels?: Map<string, string>): DrosteGallery {
	const nodeKeys = new Map<string, string[]>();
	const nodeLabel = new Map<string, string>();
	for (const n of data.nodes) {
		nodeKeys.set(n.id, keysOf(n));
		nodeLabel.set(n.id, n.label);
	}
	// link (source→target) / backlink (target→source) adjacency for ⑤.
	const links = new Map<string, string[]>();
	const backlinks = new Map<string, string[]>();
	for (const e of data.edges) {
		if (!nodeLabel.has(e.source) || !nodeLabel.has(e.target) || e.source === e.target) continue;
		(links.get(e.source) ?? links.set(e.source, []).get(e.source)!).push(e.target);
		(backlinks.get(e.target) ?? backlinks.set(e.target, []).get(e.target)!).push(e.source);
	}
	const cols = Math.max(1, Math.ceil(Math.sqrt(data.nodes.length)));
	const rows = Math.max(1, Math.ceil(data.nodes.length / cols));
	const cells: GalleryCell[] = data.nodes.map((n, i) => ({
		id: n.id, label: n.label, col: i % cols, row: Math.floor(i / cols),
	}));
	return { cells, cols, rows, nodeKeys, nodeLabel, labels: labels ?? new Map(), links, backlinks };
}

// Build one node's icon diagram (spec §1). Group every OTHER node M by the part of the
// focus tags it shares, O(M) = T ∩ sig(M); place it at level d = |T| − |O| (d=0 ⇒ ②,
// d=1 ⇒ ③₁, …). So ② = nodes sharing ALL of T, ③₁ = nodes sharing all-but-one tag of T
// grouped by which subset, etc. Nodes sharing nothing (O=∅) are excluded. Per-set draw
// cap = 2^(n-1); the remainder folds into `overflow`. No exact-signature requirement, so
// "share a subset of T" groups (e.g. {character} when T={character,hero}) are populated.
export function buildIcon(g: DrosteGallery, focusId: string): IconDiagram {
	const clusterLabel = (k: string): string => g.labels.get(k) ?? k;
	const sigLabel = (keys: string[]): string => (keys.length ? keys.map(clusterLabel).join(" ∩ ") : "(none)");
	const T = g.nodeKeys.get(focusId) ?? [];
	const focusLabel = g.nodeLabel.get(focusId) ?? focusId;
	const k = T.length;
	const Tset = new Set(T);
	// EXCLUSIVE members keyed by O(M) = T ∩ sig(M); plus the set of distinct observed O's
	// (for the "region non-empty" test: region(S) ≠ ∅ ⟺ some observed O ⊇ S).
	const excl = new Map<string, { id: string; label: string }[]>();
	const observed: Set<string>[] = [];
	const seenO = new Set<string>();
	for (const [id, keys] of g.nodeKeys) {
		if (id === focusId) continue;
		const O = keys.filter((kk) => Tset.has(kk));
		if (O.length === 0) continue;
		const sig = O.join(SEP);
		const arr = excl.get(sig);
		if (arr) arr.push({ id, label: g.nodeLabel.get(id) ?? id });
		else { excl.set(sig, [{ id, label: g.nodeLabel.get(id) ?? id }]); }
		if (!seenO.has(sig)) { seenO.add(sig); observed.push(new Set(O)); }
	}
	// Enumerate the subsets of T to draw. |T|≤3 ⇒ ALL non-empty subsets (incl T itself for
	// ②). |T|≥4 ⇒ best-effort: T plus subsets of size |T|−1 and |T|−2 only.
	const subsets: string[][] = [];
	const all: string[][] = [];
	const recur = (start: number, cur: string[]): void => {
		all.push([...cur]);
		for (let i = start; i < T.length; i++) { cur.push(T[i]); recur(i + 1, cur); cur.pop(); }
	};
	recur(0, []);
	for (const S of all) {
		if (S.length === 0) continue;
		if (k > 3 && S.length < k && S.length < k - 2) continue; // 4+ tags: only sizes k, k−1, k−2
		subsets.push(S);
	}
	const present = (S: string[]): boolean => observed.some((O) => S.every((x) => O.has(x)));
	const byLevel = new Map<number, IconSet[]>();
	for (const S of subsets) {
		const d = k - S.length;
		// ② (d=0, S=T) is N's OWN enclosure — always drawn (empty if no T-exact peers,
		// spec §5「該当なしなら②は空」). Proper subsets (③, d≥1) are drawn only if their
		// region is non-empty.
		if (d > 0 && !present(S)) continue;
		const n = d + 2;
		const cap = Math.pow(4, n) - 1; // per-set draw cap (spec 2026-06-01)
		const mem = (excl.get(S.join(SEP)) ?? []).slice().sort((a, b) => (a.id < b.id ? -1 : 1));
		const take = Math.min(mem.length, cap);
		const set: IconSet = { keys: S, label: sigLabel(S), members: mem.slice(0, take), overflow: mem.length - take };
		const arr = byLevel.get(d);
		if (arr) arr.push(set); else byLevel.set(d, [set]);
	}
	const levels: IconLevel[] = [];
	const maxD = byLevel.size ? Math.max(...byLevel.keys()) : -1;
	for (let d = 0; d <= maxD; d++) {
		const sets = byLevel.get(d);
		if (!sets) continue;
		sets.sort((a, b) => b.keys.length - a.keys.length || b.members.length - a.members.length || (a.label < b.label ? -1 : 1));
		levels.push({ n: d + 2, sets });
	}

	// ⑤ "link | backlink": the OUTERMOST ring. Links = notes N points to; backlinks =
	// notes pointing to N (minus those already counted as links, so each node appears
	// once). Coloured per relationship. Cap follows the same 4^n−1 rule.
	const linkIds = g.links.get(focusId) ?? [];
	const linkSet = new Set(linkIds);
	const backIds = (g.backlinks.get(focusId) ?? []).filter((id) => !linkSet.has(id));
	const toCell = (id: string) => ({ id, label: g.nodeLabel.get(id) ?? id });
	if (linkIds.length || backIds.length) {
		const n5 = (levels.length ? levels[levels.length - 1].n : 2) + 1;
		const cap5 = Math.pow(4, n5) - 1;
		const mk = (ids: string[], label: string, hue: number): IconSet => {
			const m = [...new Set(ids)].sort().map(toCell);
			return { keys: [label], label, members: m.slice(0, cap5), overflow: Math.max(0, m.length - cap5), hue };
		};
		const sets: IconSet[] = [];
		if (linkIds.length) sets.push(mk(linkIds, "link", LINK_HUE));
		if (backIds.length) sets.push(mk(backIds, "backlink", BACKLINK_HUE));
		levels.push({ n: n5, sets, kind: "link" });
	}
	return { focusId, focusLabel, tKeys: T, levels };
}

// ⑤ link/backlink colours (distinct from the tag palette).
export const LINK_HUE = 190; // link = cyan
export const BACKLINK_HUE = 25; // backlink = orange
