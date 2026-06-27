// F4-1 — shape channel + stable category→shape mapping.
import { ok } from "./assert";
import { SHAPES, shapeForKey, type NodeShape } from "../src/encoding/shapes";
import { resolveChannel } from "../src/encoding/channels";
import type { NodeDrawParams, ScaledValue } from "../src/encoding/types";

// shapeForKey is deterministic and order-independent.
{
	const shape1 = shapeForKey("status");
	const shape2 = shapeForKey("status");
	ok(shape1 === shape2, "same key → same shape");
	ok(SHAPES.includes(shapeForKey("anything")), "result is always a known shape");
	// A handful of distinct keys should spread across more than one shape.
	const got = new Set(["a", "b", "c", "d", "e", "f", "g", "h"].map(shapeForKey));
	ok(got.size >= 3, "distinct keys spread across shapes (got " + got.size + ")");
}

// The shape channel is registered, categorical/ordinal only, applies everywhere.
{
	const ch = resolveChannel("shape");
	ok(!!ch, "shape channel registered");
	ok(ch!.accepts.includes("categorical") && ch!.accepts.includes("ordinal"), "accepts categorical/ordinal");
	ok(ch!.accepts.includes("quantitative") === false, "does not accept quantitative");
	ok(ch!.appliesTo("euler") && ch!.appliesTo("heatmap"), "applies in every mode");
}

// apply(): writes params.shape from the category, matching shapeForKey.
{
	const ch = resolveChannel("shape")!;
	const p: NodeDrawParams = {};
	const scaled: ScaledValue = { category: "permanent", output: "#abc" };
	ch.apply(p, scaled, { nowMs: 0 });
	ok(p.shape === shapeForKey("permanent"), "shape derived from category, not colour");
}

// apply(): missing value leaves shape unset.
{
	const ch = resolveChannel("shape")!;
	const p: NodeDrawParams = {};
	ch.apply(p, { missing: true }, { nowMs: 0 });
	ok(p.shape === undefined, "missing → no shape");
}

// apply(): falls back to output when no category (palette-resolved only).
{
	const ch = resolveChannel("shape")!;
	const p: NodeDrawParams = {};
	ch.apply(p, { output: "blue" }, { nowMs: 0 });
	ok(p.shape === shapeForKey("blue"), "uses output when category absent");
}

// SHAPES is a non-empty stable list (cycling base for many categories).
{
	const all: NodeShape[] = [...SHAPES];
	ok(all.length >= 4, "at least 4 distinguishable shapes");
}
