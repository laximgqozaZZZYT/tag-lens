// contentBounds(clusters, nodes) — world-space bbox of the panorama fit.
// Clusters are top-left anchored; node cards are centre anchored (x ± w/2).
import { ok } from "./assert";
import { contentBounds } from "../src/layout/content-bounds";

// Empty in both arms → null (caller skips the fit).
ok(contentBounds([], []) === null, "no clusters + no nodes → null");

// A single top-left cluster spans [x, x+width] × [y, y+height].
{
	const b = contentBounds([{ x: 10, y: 20, width: 30, height: 40 }], []);
	ok(b !== null, "cluster-only → bounds");
	ok(b?.minX === 10 && b?.maxX === 40, "cluster X = [x, x+width]");
	ok(b?.minY === 20 && b?.maxY === 60, "cluster Y = [y, y+height]");
}

// A single centre-anchored node card spans x ± width/2, y ± height/2.
{
	const b = contentBounds([], [{ x: 100, y: 100, width: 20, height: 40 }]);
	ok(b?.minX === 90 && b?.maxX === 110, "node X = x ± width/2");
	ok(b?.minY === 80 && b?.maxY === 120, "node Y = y ± height/2");
}

// Clusters + nodes: the box is the union of both arms.
{
	const b = contentBounds(
		[{ x: 0, y: 0, width: 10, height: 10 }],
		[{ x: 100, y: 100, width: 20, height: 20 }],
	);
	ok(b?.minX === 0 && b?.minY === 0, "union keeps the cluster min corner");
	ok(b?.maxX === 110 && b?.maxY === 110, "union keeps the node max corner");
}

// A stray card left of / above the clusters extends the min corner (the
// NONE_BUCKET case the comment calls out).
{
	const b = contentBounds(
		[{ x: 0, y: 0, width: 50, height: 50 }],
		[{ x: -100, y: -100, width: 10, height: 10 }],
	);
	ok(b?.minX === -105 && b?.minY === -105, "stray card pulls the min corner out");
	ok(b?.maxX === 50 && b?.maxY === 50, "clusters keep the max corner");
}
