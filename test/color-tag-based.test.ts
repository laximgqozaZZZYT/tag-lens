// colorIsTagBased: the multi-tag stripe / legend-lie guard. Locks: no colour
// binding → tag-based; an enabled colour→tag binding → tag-based; an enabled
// colour binding to any OTHER field claims the fill → not tag-based; a disabled
// colour binding is inert → stays tag-based; non-colour bindings are ignored.
import { ok } from "./assert";
import { colorIsTagBased } from "../src/encoding/color-tag-based";
import type { EncodingBinding } from "../src/encoding/types";

const bind = (
	channelId: string,
	fieldId: string,
	enabled: boolean,
): EncodingBinding => ({ channelId, fieldId, enabled });

// No bindings at all → the fill is the natural striped tag case.
ok(colorIsTagBased([]) === true, "empty bindings → tag-based");

// An enabled colour→tag binding leaves the fill tag-based.
ok(
	colorIsTagBased([bind("color", "tag", true)]) === true,
	"enabled color→tag → tag-based",
);

// An enabled colour binding to another field claims the fill.
ok(
	colorIsTagBased([bind("color", "maturity", true)]) === false,
	"enabled color→maturity → not tag-based",
);

// A disabled colour binding is inert — the stripe still shows.
ok(
	colorIsTagBased([bind("color", "maturity", false)]) === true,
	"disabled color binding → tag-based",
);

// Non-colour channels never claim the fill, whatever they encode.
ok(
	colorIsTagBased([bind("size", "degree", true), bind("axisX", "ageDays", true)]) === true,
	"non-color bindings ignored → tag-based",
);

// The colour binding wins even when other enabled channels are present.
ok(
	colorIsTagBased([bind("size", "degree", true), bind("color", "status", true)]) === false,
	"enabled color→status among others → not tag-based",
);
