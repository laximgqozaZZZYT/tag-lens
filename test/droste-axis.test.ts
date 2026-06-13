// Icon Gallery (droste) custom-axis (col,row) assignment: categorical bands,
// quantitative bins, single-axis binding, selection non-interference (every cell
// placed exactly once at a unique position), and band-geometry for the grid.
import { ok } from "./assert";
import { assignGalleryAxes } from "../src/droste-axis";
import type { GalleryCell } from "../src/droste-layout";
import type { EncContext, EncNode, EncodingBinding } from "../src/encoding/types";

const ctx: EncContext = {
	nowMs: 0,
	degreeOf: (id) => ({ inDeg: 0, outDeg: 0, degree: id === "a" ? 1 : id === "b" ? 9 : id === "c" ? 5 : 3 }),
	frontmatterOf: () => undefined,
};
const NODES: Record<string, EncNode> = {
	a: { id: "a", memberships: ["x"] },
	b: { id: "b", memberships: ["y"] },
	c: { id: "c", memberships: ["x"] },
	d: { id: "d", memberships: ["y"] },
};
const nodeFor = (id: string): EncNode => NODES[id];
function cells(): GalleryCell[] {
	return ["a", "b", "c", "d"].map((id, i) => ({ id, label: id, col: i, row: 0 }));
}
const bind = (channelId: string, fieldId: string, scaleType?: string): EncodingBinding => ({
	channelId,
	fieldId,
	enabled: true,
	scale: scaleType ? ({ type: scaleType } as EncodingBinding["scale"]) : undefined,
});

// Helper: assert all cells placed once, at unique (col,row), inside the grid.
function checkInvariant(res: ReturnType<typeof assignGalleryAxes>, ids: string[]): void {
	ok(res.pos.size === ids.length, "every cell placed exactly once");
	const seen = new Set<string>();
	for (const id of ids) {
		const p = res.pos.get(id)!;
		ok(p != null, `cell ${id} has a position`);
		ok(p.col >= 0 && p.col < res.cols && p.row >= 0 && p.row < res.rows, `cell ${id} within grid`);
		const key = `${p.col},${p.row}`;
		ok(!seen.has(key), `cell ${id} at a unique (col,row)`);
		seen.add(key);
	}
}

// X = tag (categorical): one column-band per distinct tag (x, y). a,c (tag x) end
// up left of b,d (tag y). Y unbound ⇒ members stack within a band.
{
	const res = assignGalleryAxes(cells(), nodeFor, ctx, bind("axisX", "tag"), undefined);
	checkInvariant(res, ["a", "b", "c", "d"]);
	ok(res.axes.x?.kind === "categorical" && res.axes.x.bands?.length === 2, "two categorical X bands");
	ok(res.axes.x!.bands![0].label === "x" && res.axes.x!.bands![1].label === "y", "band labels x,y");
	const pa = res.pos.get("a")!, pc = res.pos.get("c")!, pb = res.pos.get("b")!, pd = res.pos.get("d")!;
	ok(pa.col < pb.col && pa.col < pd.col, "tag x cells left of tag y cells");
	ok(pc.col < pb.col, "node c (tag x) also in left band");
	// Y unbound ⇒ tag-x members (a,c) share the column but different rows.
	ok(pa.col === pc.col && pa.row !== pc.row, "co-located band members stacked apart");
}

// Y = degree (quantitative): cells bin into rows monotonically (low degree → low
// bin → top). a(deg1) < d(deg3) < c(deg5) < b(deg9).
{
	const res = assignGalleryAxes(cells(), nodeFor, ctx, undefined, bind("axisY", "degree", "linear"));
	checkInvariant(res, ["a", "b", "c", "d"]);
	ok(res.axes.y?.kind === "quantitative", "quantitative Y axis");
	ok((res.axes.y!.ticks?.length ?? 0) > 0, "quantitative Y has ticks");
	const ra = res.pos.get("a")!.row, rb = res.pos.get("b")!.row, rc = res.pos.get("c")!.row, rd = res.pos.get("d")!.row;
	ok(ra <= rd && rd <= rc && rc <= rb, "degree maps monotonically along rows");
	ok(ra < rb, "min-degree strictly above max-degree");
}

// Both axes bound: X=tag, Y=degree → a 2-D scatter. Still every cell unique.
{
	const res = assignGalleryAxes(cells(), nodeFor, ctx, bind("axisX", "tag"), bind("axisY", "degree", "linear"));
	checkInvariant(res, ["a", "b", "c", "d"]);
	ok(res.axes.x != null && res.axes.y != null, "both axis specs present");
}

// Missing values get a trailing bucket; cell is NOT dropped (non-interference).
{
	const NODES2: Record<string, EncNode> = {
		a: { id: "a", memberships: ["x"] },
		b: { id: "b", memberships: [] }, // no tag → memberships[0] is null → missing bucket
	};
	const c2: GalleryCell[] = [
		{ id: "a", label: "a", col: 0, row: 0 },
		{ id: "b", label: "b", col: 1, row: 0 },
	];
	const res = assignGalleryAxes(c2, (id) => NODES2[id], ctx, bind("axisX", "tag"), undefined);
	checkInvariant(res, ["a", "b"]);
	const pa = res.pos.get("a")!, pb = res.pos.get("b")!;
	ok(pa.col !== pb.col, "missing-tag cell lands in its own (trailing) band");
}

// Band start/end geometry is monotone non-decreasing and covers the grid width.
{
	const res = assignGalleryAxes(cells(), nodeFor, ctx, bind("axisX", "tag"), undefined);
	const bands = res.axes.x!.bands!;
	ok(bands[0].start === 0, "first band starts at 0");
	for (let i = 1; i < bands.length; i++) ok(bands[i].start === bands[i - 1].end, "bands are contiguous");
	ok(bands[bands.length - 1].end === res.cols, "last band ends at grid width");
}
