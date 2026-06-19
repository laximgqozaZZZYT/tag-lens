// R5' — settings type-rot guard. tsc already enforces that DEFAULT_SETTINGS
// covers every REQUIRED MiniSettings field (it is annotated `: MiniSettings`,
// so a missing key or an excess key is a compile error). These runtime checks
// close the gaps tsc cannot see:
//   1. no default is `undefined` (defeats the {...DEFAULT_SETTINGS, ...raw} merge),
//   2. every default is JSON-serializable (settings persist to data.json — a
//      non-serializable default is silent data loss on save),
//   3. an inventory lock on the exact key set, so adding/removing a setting is a
//      deliberate, reviewable change (mirrors AGENTS gotcha #4: update BOTH the
//      MiniSettings interface AND DEFAULT_SETTINGS).
import { ok } from "./assert";
import { DEFAULT_SETTINGS } from "../src/types";

// 1. No undefined defaults.
for (const [k, v] of Object.entries(DEFAULT_SETTINGS)) {
	ok(v !== undefined, `DEFAULT_SETTINGS.${k} is undefined — give it a concrete default`);
}

// 2. JSON round-trip is lossless (defaults must survive persistence to data.json).
{
	const round = JSON.parse(JSON.stringify(DEFAULT_SETTINGS));
	ok(
		JSON.stringify(round) === JSON.stringify(DEFAULT_SETTINGS),
		"DEFAULT_SETTINGS is not JSON-round-trip stable (a default is non-serializable)",
	);
}

// 3. Inventory lock: the canonical default key set. When you add or remove a
//    setting, update this list in the same change — the diff makes it reviewable.
{
	const EXPECTED_KEYS = [
		"W_link", "W_tag", "aggregatedLayers", "aggregationSettings", "anchorPlacement", "autoFollowActiveNote",
		"bipartiteLayout", "bipartiteMaxTags", "cardMaxChars", "closeupMode", "clusterOffsets",
		"clusterSpacing", "drosteFocus", "dvjsFilter", "encoding", "expandNeighborhood",
		"filterMode", "gapFinder", "ghostEdgeMinJaccard", "globalAggregationAttribute", "groupBy", "groupByAuto",
		"having", "havingAuto", "havingMode", "heatmapCriterion", "heatmapJaccard",
		"heatmapMinTagSize", "heatmapSortDir", "hiddenNodes", "inheritFrom", "latticeDensityCells",
		"latticeDensityMax", "latticeIndividualMax", "latticeMaxNodesPerTier", "latticeMinNodeSize", "latticeNamedMax",
		"latticeNodeLOD", "latticeShowSubsetLinks", "latticeSpecificTop", "layerInheritFull", "legendHiddenModes", "legendPos", "lensPresets", "limit",
		"limitAuto", "matrixBlockPriority", "matrixCollapseGroups", "matrixGroupBySignature", "matrixMinColumnSize",
		"matrixSort", "matrixSortDir", "maxNeighborhoodSize", "minFontPx", "nodeCols",
		"nodeDisplayOverrides", "nodeOffsets", "nodeRows", "nodeSpacing", "noteMenuVisible",
		"orderDir", "orderField", "panelVisible", "panoramaMode", "perspective",
		"showBody", "showEdges", "showEnclosures", "showGhostEdges", "showGrid", "showLegend",
		"showMaturity", "showNodes", "staleDays", "streamAxisField", "streamBinning",
		"streamRowSort", "upsetColumnSort", "upsetMinColumnSize", "viewMode", "where",
		"whereAuto",
	].sort();
	const actual = Object.keys(DEFAULT_SETTINGS).sort();
	const added = actual.filter((k) => !EXPECTED_KEYS.includes(k));
	const removed = EXPECTED_KEYS.filter((k) => !actual.includes(k));
	ok(
		added.length === 0 && removed.length === 0,
		`DEFAULT_SETTINGS key set drifted — update EXPECTED_KEYS and MiniSettings together.\n  added: [${added.join(", ")}]\n  removed: [${removed.join(", ")}]`,
	);
}
