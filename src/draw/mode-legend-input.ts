import type { ModeLegendInput } from "./mode-legend";
import { clusterHue, createStripePattern } from "./canvas-utils";
import { theme } from "./theme";
import { encodingToSpecs } from "./legend-spec";
import { lodFor } from "../layout/lattice-layout";
import type { LaidOut } from "../layout/layout";
import type { MiniSettings } from "../types";
import { NONE_BUCKET } from "../types";
import type { BindingLegend } from "../encoding/evaluate";
import {
	UNION_LAYER_KEY,
	INTERSECTION_LAYER_KEY,
	SET_LAYER_LABEL,
} from "../visual/node-display";
import { pluralize } from "../util/pluralize";

// Pure inputs the legend builder reads off the view. Extracted verbatim from
// MiniGraphView so the (large) data-shaping logic lives in one testable place;
// the view keeps a thin wrapper that forwards `this` state through these deps.
// `resolveLayerDisplay` is the view's only behavioural callback — typed inline
// (structurally identical to NodeDisplay) so this module need not import
// node-display just for the two fields the builder reads.
export interface ModeLegendInputDeps {
	settings: MiniSettings;
	laid: LaidOut;
	encLegends: BindingLegend[];
	clusterLabels: Map<string, string>;
	zoom: number;
	resolveLayerDisplay: (groupKey: string) => { nodeRows: number; nodeCols: number };
}

export function computeModeLegendInput(deps: ModeLegendInputDeps): ModeLegendInput {
	const isBubbles = deps.settings.viewMode === "bubblesets";
	const encodingSpecs = isBubbles ? [] : encodingToSpecs(deps.encLegends);
	const t = theme();
	const aggSet = new Set(deps.settings.aggregatedLayers);
	// LAYERS & OVERRIDES content is surfaced in EVERY view mode and perspective
	// now (the ∪/∩ set-layers + the resolved NODE_DISPLAY suffix), keeping the
	// per-mode intrinsic legends intact and merely ADDING the layer info.
	const isCloseup = deps.settings.perspective === "closeup";
	// Per-tag VISIBLE COUNT that is correct in every view mode. Euler-family
	// stores it on `cluster.memberCount`, but node-grid modes (upset) and
	// droste leave `laid.clusters` empty, so the count must be derived from
	// each mode's own structure:
	//   • droste     → distinct gallery nodes whose tag-keys include the tag
	//   • clusters   → `cluster.memberCount` (already post-hide/aggregate)
	//   • node modes → `laid.nodes` whose memberships include the tag
	// All sources are post-hide/post-aggregate, so each is the live count.
	const tagVisibleCount = (tag: string): number => {
		const cluster = deps.laid.clusters?.find((c) => c.groupKey === tag);
		if (cluster) return cluster.memberCount ?? 0;
		const gallery = deps.laid.drosteGallery;
		if (gallery?.cells.length) {
			const ids = new Set<string>();
			for (const cell of gallery.cells) {
				if ((gallery.nodeKeys.get(cell.id) ?? []).includes(tag)) ids.add(cell.id);
			}
			if (ids.size) return ids.size;
		}
		const latNodes = deps.laid.lattice?.nodes;
		if (latNodes?.length) {
			let sum = 0;
			for (const node of latNodes) {
				if (node.signature?.includes(tag)) sum += node.count ?? 0;
			}
			if (sum > 0) return sum;
		}
		let n = 0;
		for (const node of deps.laid.nodes) if (node.memberships?.includes(tag)) n++;
		return n;
	};
	// LAYERS & OVERRIDES content per layer, expressed with the SAME terms the
	// Settings ▸ Encode ▸ "Layers & Overrides" UI uses, so the legend faithfully
	// mirrors the panel:
	//   • Node display "Size (m × n)"        → `Size R×C`
	//   • header meta "N nodes"              → `N nodes`
	//   • Display "Aggregate (3-card stack)" → `Aggregate (3-card stack)`
	//   • "Inherit from" / "Full inheritance"→ `Inherit from <parent>` /
	//                                           `Full inheritance`
	// Parts are joined with " · " to match the panel's stacked fields. Shown in
	// EVERY view mode + perspective. `count` lets callers pass a pre-resolved
	// figure (e.g. the cluster's own memberCount) instead of re-deriving it;
	// when no count is derivable the count part is safely omitted.
	const clusterLabelFor = (groupKey: string): string =>
		deps.laid.clusters?.find((c) => c.groupKey === groupKey)?.label ?? groupKey;
	// Inheritance descriptor matching the panel's "Inherit from" picker and the
	// set-layer "Full inheritance (ignore own overrides)" toggle.
	const inheritPart = (groupKey: string): string | null => {
		const isSetLayer = groupKey === UNION_LAYER_KEY || groupKey === INTERSECTION_LAYER_KEY;
		const parent = deps.settings.inheritFrom?.[groupKey];
		const full = isSetLayer && (deps.settings.layerInheritFull?.includes(groupKey) ?? false);
		if (full) {
			return parent
				? `Full inheritance from ${clusterLabelFor(parent)}`
				: "Full inheritance";
		}
		if (parent) return `Inherit from ${clusterLabelFor(parent)}`;
		return null;
	};
	// Build the " · "-joined "Size R×C · N nodes · …" suffix from the resolved
	// NODE_DISPLAY (= the value the renderer + panel placeholder both use).
	const layerSuffix = (groupKey: string, count?: number): string => {
		const n = count ?? tagVisibleCount(groupKey);
		const d = deps.resolveLayerDisplay(groupKey);
		const parts: string[] = [`Size ${d.nodeRows}×${d.nodeCols}`];
		if (Number.isFinite(n)) parts.push(pluralize(n, "node"));
		if (aggSet.has(groupKey)) parts.push("Aggregate (3-card stack)");
		const inh = inheritPart(groupKey);
		if (inh) parts.push(inh);
		return ` — ${parts.join(" · ")}`;
	};
	const seen = new Set<string>();
	const cleanLabel = (k: string) => k.startsWith("tag=") || k.startsWith("tag:") ? k.slice(4) : k;

	const tags: { key: string; color: string; label?: string }[] = [];
	for (const n of deps.laid.nodes) {
		const k = n.memberships?.[0];
		if (!k || seen.has(k)) continue;
		seen.add(k);
		tags.push({ key: k, color: t.swatch(clusterHue(k), "fill"), label: cleanLabel(k) + layerSuffix(k) });
	}
	if (deps.settings.viewMode === "droste" && deps.laid.drosteGallery?.cells.length) {
		const drosteSeen = new Set<string>();
		const drosteTags: { key: string; color: string; label?: string }[] = [];
		for (const cell of deps.laid.drosteGallery.cells) {
			const keys = deps.laid.drosteGallery.nodeKeys.get(cell.id) ?? [];
			for (const k of keys) {
				if (!k || drosteSeen.has(k)) continue;
				drosteSeen.add(k);
				drosteTags.push({ key: k, color: t.swatch(clusterHue(k), "fill"), label: cleanLabel(k) + layerSuffix(k) });
			}
		}
		tags.splice(0, tags.length, ...drosteTags);
	}
	let min = Infinity, max = -Infinity;
	for (const n of deps.laid.nodes) {
		const c = (n as { count?: number }).count ?? 1;
		if (c < min) min = c;
		if (c > max) max = c;
	}
	if (!Number.isFinite(min)) { min = 1; max = 1; }
	const hm = deps.laid.heatmap;
	const drosteOps = deps.settings.viewMode === "droste"
		? {
			focusColor: t.accent,
			intersectionColor: t.swatch(45, "fill"),
			unionColor: t.success,
		}
		: undefined;
	let hmTagMin = 1;
	let hmTagMax = 1;
	let hmCoMax = 1;
	if (hm && hm.tags.length > 0) {
		hmTagMin = Math.min(...hm.tags.map((x) => x.size));
		hmTagMax = Math.max(...hm.tags.map((x) => x.size));
		hmCoMax = Math.max(1, hm.p95 || hm.maxOff || 1);
	}
	let legendMin = min;
	let legendMax = max;
	let latticeInput: ModeLegendInput["lattice"] | undefined;
	if (deps.settings.viewMode === "lattice" && deps.laid.lattice?.nodes.length) {
		const nodes = deps.laid.lattice.nodes;
		const counts = nodes.map((n) => n.count);
		legendMin = Math.min(...counts);
		legendMax = Math.max(...counts);
		const lod = "auto";
		const mix: NonNullable<ModeLegendInput["lattice"]>["lodMix"] = {
			overview: 0,
			density: 0,
			individual: 0,
		};
		const classColors: NonNullable<ModeLegendInput["lattice"]>["classColors"] = {
			overview: [],
			density: [],
			individual: [],
		};
		const seenColors: Record<"overview" | "density" | "individual", Set<string>> = {
			overview: new Set(),
			density: new Set(),
			individual: new Set(),
		};
		for (const node of nodes) {
			let eff = lodFor(node.count, deps.zoom, {
				latticeNodeLOD: lod,
				latticeIndividualMax: deps.settings.latticeIndividualMax,
				latticeDensityMax: deps.settings.latticeDensityMax,
			});
			if (eff === "individual" && 12 * deps.zoom < deps.settings.minFontPx * 0.5) {
				eff = "density";
			}
			mix[eff] += 1;
			const seed = node.isOther
				? `__other__@${node.degree}`
				: node.signature.length
					? node.signature[0]
					: node.key || "?";
			const color = eff === "overview"
				? t.swatch(clusterHue(seed), "fill", 0.95)
				: eff === "density"
					? t.swatch(clusterHue(seed), "fill", 0.92)
					: t.swatch(clusterHue(seed), "fill", 0.90);
			if (!seenColors[eff].has(color)) {
				seenColors[eff].add(color);
				const head = node.displayTags?.[0] ?? node.signature?.[0] ?? node.key;
				classColors[eff].push({
					label: node.isOther ? `Other (deg ${node.degree})` : `#${head}`,
					color,
				});
			}
		}
		const nonZero = (["overview", "density", "individual"] as const).filter((k) => mix[k] > 0);
		const effectiveLod: NonNullable<ModeLegendInput["lattice"]>["effectiveLod"] =
			nonZero.length === 1 ? nonZero[0] : "mixed";
		latticeInput = {
			lod,
			effectiveLod,
			individualMax: deps.settings.latticeIndividualMax,
			densityMax: deps.settings.latticeDensityMax,
			densityCells: deps.settings.latticeDensityCells,
			lodMix: mix,
			classColors,
		};
	}
	let groups: ModeLegendInput["groups"];
	let setLayers: ModeLegendInput["setLayers"];
	const enclosureModes = ["euler", "bubblesets"];
	// `groups` (the cluster enclosure swatches) stay INTRINSIC to enclosure
	// modes — leaving the per-mode element policy unchanged.
	if (enclosureModes.includes(deps.settings.viewMode) && deps.laid.clusters?.length) {
		// `layerSuffix` already carries "· N nodes" (faithful to the panel's
		// "N nodes" header meta), so the bare leading "(memberCount)" is dropped
		// to avoid showing the count twice. `groupEnclosures` adds the "Group: "
		// prefix that mirrors the panel's per-cluster tab.
		groups = deps.laid.clusters.map((c) => ({
			key: c.groupKey,
			label: `${c.label}${layerSuffix(c.groupKey, c.memberCount)}`,
			color: t.swatch(clusterHue(c.groupKey), "fill"),
		}));
	} else if (deps.settings.viewMode === "lattice") {
		groups = [];
		for (const k of deps.clusterLabels.keys()) {
			groups.push({
				key: k,
				label: `${cleanLabel(deps.clusterLabels.get(k) ?? k)}${layerSuffix(k, tagVisibleCount(k))}`,
				color: t.swatch(clusterHue(k), "fill"),
			});
		}
	}
	// ∪ / ∩ are addressable layers DISTINCT from the single-tag clusters and are
	// surfaced in EVERY view mode. `unionN` = distinct visible notes, `interN` =
	// notes carrying 2+ tags. Each mode keeps its visible notes in a different
	// place, so derive the membership multiplicity from whichever source the
	// current layout populated (mirrors tagVisibleCount):
	//   • node modes → `laid.nodes[].memberships`
	//   • droste     → `laid.drosteGallery.nodeKeys` (cell id → tag keys)
	// resolveSetLayer applies the single-tag superset cascade (full/partial
	// inheritance) so single-set settings influence ∪/∩.
	const setMembershipCounts = (): { unionN: number; interN: number; pairwise: { t1: string; t2: string; interN: number; unionN: number }[] } | null => {
		const nodeTags: string[][] = [];
		const tagCounts = new Map<string, number>();

		if (deps.laid.nodes.length) {
			for (const n of deps.laid.nodes) {
				const tags = n.memberships ?? [];
				nodeTags.push(tags);
				for (const t of tags) tagCounts.set(t, (tagCounts.get(t) ?? 0) + 1);
			}
		} else if (deps.laid.drosteGallery?.cells.length) {
			const gallery = deps.laid.drosteGallery;
			const counted = new Set<string>();
			for (const cell of gallery.cells) {
				if (counted.has(cell.id)) continue;
				counted.add(cell.id);
				const tags = (gallery.nodeKeys.get(cell.id) ?? []).filter((k) => k !== NONE_BUCKET);
				nodeTags.push(tags);
				for (const t of tags) tagCounts.set(t, (tagCounts.get(t) ?? 0) + 1);
			}
		} else {
			return null;
		}

		let unionN = 0, interN = 0;
		const pairInter = new Map<string, number>();

		for (const tags of nodeTags) {
			if (tags.length >= 1) unionN++;
			if (tags.length >= 2) interN++;
			const sortedTags = [...tags].sort();
			for (let i = 0; i < sortedTags.length; i++) {
				for (let j = i + 1; j < sortedTags.length; j++) {
					const t1 = sortedTags[i], t2 = sortedTags[j];
					const key = `${t1}\t${t2}`;
					pairInter.set(key, (pairInter.get(key) ?? 0) + 1);
				}
			}
		}

		const pairwise: { t1: string; t2: string; interN: number; unionN: number }[] = [];
		for (const [key, pInterN] of pairInter.entries()) {
			const [t1, t2] = key.split("\t");
			const c1 = tagCounts.get(t1) ?? 0;
			const c2 = tagCounts.get(t2) ?? 0;
			const pUnionN = c1 + c2 - pInterN;
			pairwise.push({ t1, t2, interN: pInterN, unionN: pUnionN });
		}
		pairwise.sort((a, b) => b.interN - a.interN || a.t1.localeCompare(b.t1) || a.t2.localeCompare(b.t2));

		return { unionN, interN, pairwise };
	};
	const setCounts = setMembershipCounts();
	if (setCounts) {
		const { unionN, interN, pairwise } = setCounts;
		setLayers = [];

		for (const p of pairwise) {
			const l1 = cleanLabel(deps.clusterLabels.get(p.t1) ?? p.t1);
			const l2 = cleanLabel(deps.clusterLabels.get(p.t2) ?? p.t2);

			const h1 = clusterHue(p.t1);
			const h2 = clusterHue(p.t2);
			// Striped pattern for union (horizontal) and intersection (vertical)
			setLayers.push({
				key: `__union__${p.t1}_${p.t2}`,
				label: `${l1} ∪ ${l2}${layerSuffix(UNION_LAYER_KEY, p.unionN)}`,
				color: createStripePattern([h1, h2], false),
			});
			setLayers.push({
				key: `__inter__${p.t1}_${p.t2}`,
				label: `${l1} ∩ ${l2}${layerSuffix(INTERSECTION_LAYER_KEY, p.interN)}`,
				color: createStripePattern([h1, h2], true),
			});
		}

		if (!pairwise.length && unionN > 0) {
			setLayers.push({
				key: UNION_LAYER_KEY,
				label: `${SET_LAYER_LABEL[UNION_LAYER_KEY]}${layerSuffix(UNION_LAYER_KEY, unionN)}`,
				color: t.swatch(140, "fill"),
			});
			setLayers.push({
				key: INTERSECTION_LAYER_KEY,
				label: `${SET_LAYER_LABEL[INTERSECTION_LAYER_KEY]}${layerSuffix(INTERSECTION_LAYER_KEY, interN)}`,
				color: t.swatch(45, "fill"),
			});
		}
	}
	return {
		encodingSpecs,
		tags,
		groups,
		setLayers,
		// DISPLAY-UNIT flag only: in closeup ∪/∩ are shown as an independent
		// legend section (incl. enclosure modes) instead of being folded into
		// the single-tag "Groups & overlap" spec. The ∪/∩ VALUES above are still
		// the resolveSetLayer()-backed labels, so single-set settings keep
		// cascading into ∪/∩ — only the display unit is split out.
		closeup: isCloseup,
		counts: { min: legendMin, max: legendMax },
		droste: drosteOps,
		lattice: latticeInput,
		heatmap: {
			jaccard: !!deps.settings.heatmapJaccard,
			tagMin: hmTagMin,
			tagMax: hmTagMax,
			coMax: hmCoMax,
		},
	};
}
