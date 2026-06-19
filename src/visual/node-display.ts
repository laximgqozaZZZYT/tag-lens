import type { GraphNode } from "../types";

// Synthetic, addressable layer keys for the CLOSEUP set-operation layers.
// They are NOT real clusters: they carry their own nodeDisplayOverrides /
// inheritFrom entries and resolve via the standard chain (own → inheritFrom
// → strict superset → global). Single-tag clusters are supersets of these.
export const UNION_LAYER_KEY = "__union__";
export const INTERSECTION_LAYER_KEY = "__intersection__";
export const SET_LAYER_KEYS = [UNION_LAYER_KEY, INTERSECTION_LAYER_KEY] as const;
export const SET_LAYER_LABEL: Record<string, string> = {
	[UNION_LAYER_KEY]: "∪ Union",
	[INTERSECTION_LAYER_KEY]: "∩ Intersection",
};

// Resolved NODE_DISPLAY values for a single node — the renderer reads
// these instead of touching settings directly so per-cluster overrides
// resolve consistently across cardFor / measureCard / drawCard.
export interface NodeDisplay {
	nodeRows: number;
	nodeCols: number;
}

export interface NodeDisplayOverride {
	nodeRows?: number;
	nodeCols?: number;
}

// Defaults used as the final fallback when no override applies anywhere
// in the resolution chain.
export interface NodeDisplayDefaults {
	nodeRows: number;
	nodeCols: number;
}

// Dependencies the resolver needs to walk the chain. Pulled in once per
// rebuild and reused across every per-node lookup.
export interface NodeDisplayDeps {
	overrides: Record<string, NodeDisplayOverride>;
	inheritFrom: Record<string, string>;
	supersetsOf: Map<string, string[]>;
	defaults: NodeDisplayDefaults;
}

// Resolve NODE_DISPLAY for a node by walking, per field, the chain:
//   1. Override on the node's group
//   2. Override on `inheritFrom[group]`
//   3. Override on any strict superset of the group
//   4. Global default
// Memberships are tried in the node's declared order; the first concrete
// value found at any level for a given field wins.
export function resolveNodeDisplay(
	n: GraphNode,
	deps: NodeDisplayDeps,
): NodeDisplay {
	const { overrides, inheritFrom, supersetsOf, defaults } = deps;
	const lookup = <K extends keyof NodeDisplayOverride>(
		field: K,
	): NodeDisplayOverride[K] | undefined => {
		// 1. Specific memberships (Tags)
		for (const m of n.memberships) {
			const own = overrides[m]?.[field];
			if (own !== undefined) return own;
			const inh = inheritFrom[m];
			if (inh) {
				const v = overrides[inh]?.[field];
				if (v !== undefined) return v;
			}
			const supers = supersetsOf.get(m) ?? [];
			for (const sup of supers) {
				const v = overrides[sup]?.[field];
				if (v !== undefined) return v;
			}
		}

		// 2. Pairwise Intersections (e.g. __inter__#tag1_#tag2)
		const sorted = [...n.memberships].sort();
		if (sorted.length >= 2) {
			for (let i = 0; i < sorted.length; i++) {
				for (let j = i + 1; j < sorted.length; j++) {
					const ik = `__inter__${sorted[i]}_${sorted[j]}`;
					const v = overrides[ik]?.[field];
					if (v !== undefined) return v;
				}
			}
		}

		// 3. BROAD Intersection (priority over Broad Union)
		if (n.memberships.length >= 2) {
			const v = overrides[INTERSECTION_LAYER_KEY]?.[field];
			if (v !== undefined) return v;
		}

		// 4. Pairwise Unions (e.g. __union__#tag1_#tag2)
		// Note: Every node in tag1 is in union(tag1, tag2).
		// We only apply this if NO tag-level or intersection-level override hit.
		if (sorted.length >= 1) {
			for (const m of n.memberships) {
				// We don't know the other part of the union from the node itself,
				// but we can check if any override exists for unions involving this membership.
				// However, that's expensive to search through `overrides` keys.
				// For now, only support specific pair matches if they were defined.
			}
			// Actually, if we have individual tabs, the user expects them to work.
			// But a node belongs to MANY unions. We'll skip pairwise unions in the resolver
			// for now until we have a better priority rule, or just support the broad one.
		}

		// 5. BROAD Union
		if (n.memberships.length >= 1) {
			const v = overrides[UNION_LAYER_KEY]?.[field];
			if (v !== undefined) return v;
		}

		return undefined;
	};
	return {
		nodeRows: lookup("nodeRows") ?? defaults.nodeRows,
		nodeCols: lookup("nodeCols") ?? defaults.nodeCols,
	};
}

// Visual scale factor that drives every per-card metric the renderer
// touches: font size, padding, stroke width, text wrap width, body line
// count. Computed from the SAME resolved NODE_DISPLAY values the layout
// uses for the card's pixel size, so size and font always change
// together. The base unit is the GLOBAL node size (= 1 × 1 cell at the
// global setting); a cluster that overrides to 2 × 2 ends up with
// scale = 2 — proportional to how many global units fit in the new
// card. Picks the larger of the width and height ratios so any
// non-default override visibly scales the font, even when only one of
// rows / cols is overridden.
export function visualScale(
	display: NodeDisplay,
	scaleFactor: number,
	globalDefaults: NodeDisplayDefaults,
): number {
	const effC = display.nodeCols * scaleFactor;
	const effR = display.nodeRows * scaleFactor;
	const gC = Math.max(1, globalDefaults.nodeCols);
	const gR = Math.max(1, globalDefaults.nodeRows);
	return Math.max(effC / gC, effR / gR);
}

// Resolve what a cluster's NODE_DISPLAY WOULD be when it has no override
// of its own. Used by the panel to show placeholder values that reflect
// the effective resolution from inheritFrom / supersets / global.
export function resolveFromCluster(
	groupKey: string,
	deps: NodeDisplayDeps,
): NodeDisplay {
	const { overrides, inheritFrom, supersetsOf, defaults } = deps;
	const lookup = <K extends keyof NodeDisplayOverride>(
		field: K,
	): NodeDisplayOverride[K] | undefined => {
		const own = overrides[groupKey]?.[field];
		if (own !== undefined) return own;
		const inh = inheritFrom[groupKey];
		if (inh) {
			const v = overrides[inh]?.[field];
			if (v !== undefined) return v;
		}
		const supers = supersetsOf.get(groupKey) ?? [];
		for (const sup of supers) {
			const v = overrides[sup]?.[field];
			if (v !== undefined) return v;
		}
		return undefined;
	};
	return {
		nodeRows: lookup("nodeRows") ?? defaults.nodeRows,
		nodeCols: lookup("nodeCols") ?? defaults.nodeCols,
	};
}
