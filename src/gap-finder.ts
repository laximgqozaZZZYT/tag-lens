export interface TagGap {
	a: string;
	b: string;
	expected: number;
	actual: number;
	score: number;
	i: number; // Row index
	j: number; // Col index
}

// Computes the top K gaps in the co-occurrence matrix.
// Expected co-occurrence = (sizeA * sizeB) / totalNotes
// Gap score = Expected - Actual
export function findGaps(
	tags: Array<{ key: string; label: string; size: number }>,
	counts: Uint32Array,
	n: number,
	totalNotes: number,
	topK: number
): TagGap[] {
	if (totalNotes === 0) return [];

	const gaps: TagGap[] = [];

	for (let i = 0; i < n; i++) {
		const sizeA = tags[i].size;
		// Exclude noisy tags that appear fewer than 3 times
		if (sizeA < 3) continue;

		for (let j = i + 1; j < n; j++) {
			const sizeB = tags[j].size;
			// Exclude noisy tags that appear fewer than 3 times
			if (sizeB < 3) continue;

			const expected = (sizeA * sizeB) / totalNotes;
			const actual = counts[i * n + j];

			// Only consider if actual is significantly less than expected
			if (actual < expected) {
				const score = expected - actual;
				gaps.push({
					a: tags[i].label,
					b: tags[j].label,
					expected,
					actual,
					score,
					i,
					j
				});
			}
		}
	}

	// Sort by score descending and return top K
	gaps.sort((a, b) => b.score - a.score);
	return gaps.slice(0, topK);
}
