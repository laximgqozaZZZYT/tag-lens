import { ok, approx } from "./assert";
import { freshnessAlpha, staleClusters } from "../src/freshness";

// freshnessAlpha
{
	const now = 1000000000000;
	const staleDays = 14;
	const msPerDay = 1000 * 60 * 60 * 24;

	// 0 days old -> 1.0
	ok(freshnessAlpha(now, now, staleDays) === 1.0, "0 days old alpha is 1.0");

	// > staleDays -> 0.35
	ok(freshnessAlpha(now - msPerDay * 20, now, staleDays) === 0.35, "Stale alpha is 0.35");

	// Exactly staleDays -> 0.35
	approx(freshnessAlpha(now - msPerDay * 14, now, staleDays), 0.35, 0.001, "Exactly stale days alpha is 0.35");

	// Halfway -> linear interpolation between 1.0 and 0.35 = 0.675
	approx(freshnessAlpha(now - msPerDay * 7, now, staleDays), 0.675, 0.001, "Halfway alpha is 0.675");
}

// staleClusters
{
	const now = 1000000000000;
	const staleDays = 14;
	const msPerDay = 1000 * 60 * 60 * 24;

	const clusters = [
		{ key: "fresh", newestMtime: now - msPerDay * 2, size: 5 },
		{ key: "stale-15", newestMtime: now - msPerDay * 15, size: 3 },
		{ key: "stale-20", newestMtime: now - msPerDay * 20, size: 10 }
	];

	const result = staleClusters(clusters, now, staleDays);

	ok(result.length === 2, "Found exactly two stale clusters");
	
	const s15 = result.find(r => r.key === "stale-15");
	ok(s15 != null && s15.daysStale === 15, "stale-15 is 15 days stale");

	const s20 = result.find(r => r.key === "stale-20");
	ok(s20 != null && s20.daysStale === 20, "stale-20 is 20 days stale");
}
