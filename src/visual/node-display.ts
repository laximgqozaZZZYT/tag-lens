import type { GraphNode } from "../types";

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
