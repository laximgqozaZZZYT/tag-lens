// Axis-driven layout: categorical bands, quantitative mapping, representative
// placement, single-axis binding, in-cell packing, and the selection
// non-interference invariant (every node placed exactly once).
import { ok, approx } from "./assert";
import { axisLayout } from "../src/layout/axis-layout";
import type { EncNode, EncContext, EncodingBinding } from "../src/encoding/types";

const ctx: EncContext = {
	nowMs: 0,
	degreeOf: (id) => ({ inDeg: 0, outDeg: 0, degree: id === "a" ? 1 : id === "b" ? 5 : 3 }),
	frontmatterOf: () => undefined,
};
function nodes(): EncNode[] {
	return [
		{ id: "a", memberships: ["x"], ageDays: 0 },
		{ id: "b", memberships: ["y"], ageDays: 50 },
		{ id: "c", memberships: ["x"], ageDays: 100 },
	];
}
const bind = (fieldId: string, scaleType?: string): EncodingBinding => ({
	channelId: "axisX",
	fieldId,
	enabled: true,
	scale: scaleType ? ({ type: scaleType } as EncodingBinding["scale"]) : undefined,
});
const OPTS = { width: 300, height: 200, cell: { w: 10, h: 10 } };

// X = tag (categorical): one band per distinct tag (encounter order x, y),
// representative value = memberships[0].
{
	const r = axisLayout(nodes(), ctx, { ...OPTS, bindingX: bind("tag") });
	ok(r.axes.x?.kind === "categorical" && r.axes.x.bands?.length === 2, "two categorical bands (x, y)");
	ok(r.axes.x!.bands![0].key === "x" && r.axes.x!.bands![1].key === "y", "bands in encounter order");
	// a and c (tag x) are left of b (tag y)
	ok(r.positions.get("a")!.x < r.positions.get("b")!.x, "tag 'x' band is left of tag 'y' band");
	ok(r.positions.get("c")!.x < r.positions.get("b")!.x, "node c (tag x) also in left band");
	// a and c share the band+cell -> packed to DIFFERENT positions (no overlap)
	const pa = r.positions.get("a")!, pc = r.positions.get("c")!;
	ok(pa.x !== pc.x || pa.y !== pc.y, "co-located nodes are packed apart");
	// unbound Y -> around the vertical centre
	ok(Math.abs(pa.y - 100) <= 10, "unbound Y stays near canvas centre");
}

// Y = ageDays (quantitative linear over [0,100]): monotonic, with ticks.
{
	const r = axisLayout(nodes(), ctx, { ...OPTS, bindingX: undefined, bindingY: { ...bind("ageDays", "linear"), channelId: "axisY" } });
	ok(r.axes.y?.kind === "quantitative" && r.axes.y.min === 0 && r.axes.y.max === 100, "quantitative domain [0,100]");
	ok((r.axes.y!.ticks?.length ?? 0) === 6, "6 gridline ticks");
	const ya = r.positions.get("a")!.y, yb = r.positions.get("b")!.y, yc = r.positions.get("c")!.y;
	ok(ya < yb && yb < yc, "ageDays maps monotonically along Y");
	approx(ya, 5, 1e-9, "ageDays 0 -> y 5");
	approx(yc, 205, 1e-9, "ageDays 100 -> y = height + 5");
}

// Y = ageDays (quantitative LOG): N1 fix — ticks are positioned via the SAME
// forward scale as node coords, so a gridline's label matches where that value
// lands. Endpoints align with linear; interior ticks compress toward the top.
{
	const r = axisLayout(nodes(), ctx, { ...OPTS, bindingY: { ...bind("ageDays", "log"), channelId: "axisY" } });
	const t = r.axes.y!.ticks!;
	ok(t.length === 6, "6 log ticks");
	ok(t[0].label === "0.0" && t[5].label === "100.0", "log tick labels are the clean even values");
	approx(t[0].pos, 0, 1e-9, "first log tick at 0");
	approx(t[5].pos, 200, 1e-9, "last log tick at extent (200)");
	// The tick labelled "60.0" sits exactly where the scale places the value 60
	// (= log(61)/log(101) * 200 ≈ 178.1), NOT at the linear midpoint 120.
	const mid = t.find((x) => x.label === "60.0")!;
	approx(mid.pos, 178.15, 0.2, "log tick '60' is positioned by the scale, not linearly");
	// gaps shrink monotonically (log compression toward the top)
	for (let i = 1; i < t.length - 1; i++) {
		ok((t[i].pos - t[i - 1].pos) > (t[i + 1].pos - t[i].pos), `log tick gap ${i} shrinks`);
	}
}

// Y = ageDays (quantitative QUANTILE): each tick value is placed at its rank
// fraction via the forward scale, so positions stay monotonic and in-range
// (never the broken linear interpolation).
{
	const r = axisLayout(nodes(), ctx, { ...OPTS, bindingY: { ...bind("ageDays", "quantile"), channelId: "axisY" } });
	const t = r.axes.y!.ticks!;
	ok(t.length === 6, "6 quantile ticks");
	for (let i = 0; i < t.length; i++) ok(t[i].pos >= 0 && t[i].pos <= 200, `quantile tick ${i} within extent`);
	for (let i = 1; i < t.length; i++) ok(t[i].pos >= t[i - 1].pos, `quantile tick ${i} monotonic`);
	ok(t[t.length - 1].pos > t[0].pos, "quantile axis spans a range (not all collapsed)");
}

// X = degree (quantitative via ctx.degreeOf): a(1) < c(3) < b(5)
{
	const r = axisLayout(nodes(), ctx, { ...OPTS, bindingX: bind("degree", "linear") });
	ok(r.positions.get("a")!.x < r.positions.get("c")!.x && r.positions.get("c")!.x < r.positions.get("b")!.x, "degree maps monotonically along X");
}

// Selection non-interference: every node placed exactly once.
{
	const r = axisLayout(nodes(), ctx, { ...OPTS, bindingX: bind("tag") });
	ok(r.positions.size === 3, "every node positioned exactly once (no add/drop)");
}

// Both axes unbound: no axes, all nodes packed around the centre, still distinct.
{
	const r = axisLayout(nodes(), ctx, OPTS);
	ok(r.axes.x === undefined && r.axes.y === undefined, "no axis specs when unbound");
	ok(r.positions.size === 3, "all nodes still placed");
	const ps = [...r.positions.values()];
	ok(new Set(ps.map((p) => `${p.x},${p.y}`)).size === 3, "unbound nodes packed to distinct spots");
}
