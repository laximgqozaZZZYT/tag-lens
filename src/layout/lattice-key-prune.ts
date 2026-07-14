// After a relayout re-buckets the lattice intersections, tracked lattice keys
// (the named-checkbox keys + the selected key) may name nodes that no longer
// exist — e.g. a tier was culled by Min intersection size, or a signature was
// top-N collapsed into an "Other" bundle whose key differs. Prune both against
// the surviving node keys so `latticeNamedKeys` never grows unboundedly and a
// stale selection can't linger. Pure: builds a fresh named-key set, never
// mutating the inputs.
export function pruneLatticeKeys(
	nodeKeys: Iterable<string>,
	namedKeys: Iterable<string>,
	selectedKey: string | null,
): { namedKeys: Set<string>; selectedKey: string | null } {
	const valid = new Set(nodeKeys);
	const survivingNamed = new Set<string>();
	for (const k of namedKeys) {
		if (valid.has(k)) survivingNamed.add(k);
	}
	// Match the view's original truthy guard exactly: an empty-string selection
	// is left untouched (the `&&` short-circuits), a real key is cleared only
	// when it no longer survives the relayout.
	return {
		namedKeys: survivingNamed,
		selectedKey: selectedKey && !valid.has(selectedKey) ? null : selectedKey,
	};
}
