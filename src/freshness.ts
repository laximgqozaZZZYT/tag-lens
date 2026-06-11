export function freshnessAlpha(mtimeMs: number, nowMs: number, staleDays: number): number {
	const msPerDay = 1000 * 60 * 60 * 24;
	const ageDays = (nowMs - mtimeMs) / msPerDay;
	if (ageDays <= 0) return 1.0;
	if (ageDays >= staleDays) return 0.35; // Lower bound ensures readability even when very stale
	
	const t = ageDays / staleDays; // 0.0 to 1.0
	// Linearly interpolate between 1.0 and 0.35
	return 1.0 - t * (1.0 - 0.35);
}

export function staleClusters(
	clusters: { key: string; newestMtime: number; size: number }[],
	nowMs: number,
	staleDays: number
): { key: string; daysStale: number }[] {
	const msPerDay = 1000 * 60 * 60 * 24;
	const result: { key: string; daysStale: number }[] = [];
	
	for (const cluster of clusters) {
		const ageDays = (nowMs - cluster.newestMtime) / msPerDay;
		if (ageDays >= staleDays) {
			result.push({ key: cluster.key, daysStale: Math.floor(ageDays) });
		}
	}
	
	return result;
}
