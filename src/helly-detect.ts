import type { Zone } from "./zone-decomp";

// Helly's theorem for axis-aligned boxes: Helly number = 2. For ANY k
// base sets, if every pair must overlap (= co-occur in a non-empty
// zone), then the k-way intersection is geometrically forced to be
// non-empty. The "zone" representing that k-way intersection has
// `count = 0` (no real node has all k memberships) but its rectangle
// will have positive area regardless.
//
// Phase A-6: enumerate all such Helly-forced zones for k ≥ 3 so Phase E
// can skip the topology penalty for them (= the empty area is correct
// behaviour, not a constraint violation).

// Enumerate k-way subsets that must geometrically overlap but have
// count(zone) = 0. Returns the set of zone keys (sorted-membership |-join)
// that are Helly-forced.
//
// Algorithm:
//   1. Collect every membership signature M that appears in a non-empty
//      zone. These are the "real" k-way co-occurrences.
//   2. For each non-empty zone with |memberships| ≥ 3, walk every
//      sub-set S ⊆ memberships of size ≥ 3 that ISN'T already realised
//      as a non-empty zone, and check whether every pair in S "must
//      overlap" (= appears together in some non-empty zone). If yes,
//      S is Helly-forced.
//
// Practical bound: in real data, multi-memberships are small (≤ 5).
// Total sub-set generations are O(non-empty zones × 2^|max memb|),
// well under 1k for typical vaults.
export function detectHellyForcedZones(
	zones: Zone[],
	mustOverlapPairs: Set<string>,
): Set<string> {
	// Index non-empty zones by their membership-signature key for O(1)
	// "is this exact combination realised?" lookups.
	const realised = new Set<string>();
	for (const z of zones) {
		if (z.count > 0) realised.add(z.key);
	}

	// Candidate k-way Helly sub-sets come from any non-empty zone's
	// memberships. Walking from non-empty zones avoids enumerating
	// astronomic sub-sets of the base-set roster.
	//
	// We also have to consider UNIONS across pairs: e.g. {A,B} and {A,C}
	// both real, so {A,B,C} is a candidate even though no zone has
	// memberships exactly = {A,B,C}. So instead of iterating zone-by-zone,
	// collect every realised pair and ascend.
	const forced = new Set<string>();

	// Build the set of every base set that participates in any non-empty
	// zone. The candidate pool of bases is small (typically ≤ 30).
	const allBases = new Set<string>();
	for (const z of zones) {
		if (z.count > 0) {
			for (const m of z.memberships) allBases.add(m);
		}
	}
	const baseList = [...allBases].sort();

	// For each k ≥ 3 sub-set of baseList, check whether all pairs are
	// "must overlap" and the sub-set is NOT realised. Skip when k > 6
	// — beyond that, layouts become illegible anyway and combinatorics
	// blow up; configurable if needed later.
	const KMAX = Math.min(6, baseList.length);
	for (let k = 3; k <= KMAX; k++) {
		enumerateCombinations(baseList, k, (combo) => {
			// All-pairs must-overlap check.
			for (let i = 0; i < combo.length; i++) {
				for (let j = i + 1; j < combo.length; j++) {
					const a = combo[i];
					const b = combo[j];
					const key = a < b ? `${a}|${b}` : `${b}|${a}`;
					if (!mustOverlapPairs.has(key)) return; // not all pairs overlap
				}
			}
			// All pairs overlap. Now check the k-way zone isn't already
			// realised; if it isn't, this is Helly-forced.
			const zoneKey = combo.join("|"); // combo is already sorted
			if (!realised.has(zoneKey)) {
				forced.add(zoneKey);
			}
		});
	}
	return forced;
}

// Enumerate all k-element combinations of `items` (lexicographic order),
// invoking `cb(combo)` for each. `items` must be pre-sorted. `combo`
// is a fresh array per invocation (callers may store it).
function enumerateCombinations<T>(
	items: T[],
	k: number,
	cb: (combo: T[]) => void,
): void {
	const n = items.length;
	if (k <= 0 || k > n) return;
	const idx = new Array<number>(k);
	for (let i = 0; i < k; i++) idx[i] = i;
	while (true) {
		cb(idx.map((i) => items[i]));
		// Find rightmost index that can be incremented.
		let i = k - 1;
		while (i >= 0 && idx[i] === n - k + i) i--;
		if (i < 0) return;
		idx[i]++;
		for (let j = i + 1; j < k; j++) idx[j] = idx[j - 1] + 1;
	}
}

// Helper: mark zones (existing + synthetic Helly-forced) so downstream
// code can iterate one combined list. Adds synthetic zones for each
// forced key not already present in `zones`. Returns the combined list.
export function materialiseHellyForcedZones(
	zones: Zone[],
	forcedKeys: Set<string>,
): Zone[] {
	const present = new Set(zones.map((z) => z.key));
	const out = [...zones];
	for (const z of out) {
		if (forcedKeys.has(z.key)) z.isHellyForced = true;
	}
	for (const key of forcedKeys) {
		if (present.has(key)) continue;
		out.push({
			key,
			memberships: key.split("|"),
			count: 0,
			nodes: [],
			isHellyForced: true,
		});
	}
	return out;
}
