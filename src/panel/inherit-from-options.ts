// Pure builder for the "Inherit from" <select> option list, shared by the
// set-layer tab (renderSetLayerTab) and the per-cluster layer tab
// (renderLayerTab) in settings-tabs.ts. Both render a leading "(none)" option
// followed by one option per cluster; the only difference is that the
// per-cluster tab excludes the cluster itself (a layer cannot inherit from
// itself). The view keeps the createEl + change-handler wiring; this returns
// just the descriptor list (value/text/selected) so the option set + selection
// rule stay test-locked and in lockstep across both call sites.

export interface InheritFromCluster {
	groupKey: string;
	label: string;
}

export interface InheritFromOption {
	value: string;
	text: string;
	selected: boolean;
}

export function inheritFromOptions(
	clusters: readonly InheritFromCluster[],
	current: string,
	excludeKey?: string,
): InheritFromOption[] {
	const opts: InheritFromOption[] = [
		{ value: "", text: "(none)", selected: current === "" },
	];
	for (const c of clusters) {
		if (excludeKey !== undefined && c.groupKey === excludeKey) continue;
		opts.push({ value: c.groupKey, text: c.label, selected: c.groupKey === current });
	}
	return opts;
}
