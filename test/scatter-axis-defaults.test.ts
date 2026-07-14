// Scatter axis defaulting (F2.4). Locks: both axes default ON to quantitative
// fields (degree / ageDays) when unbound, a user's enabled binding wins
// untouched (scale preserved), and a disabled binding is treated as unbound.
import { ok } from "./assert";
import {
	scatterAxisDefaults,
	SCATTER_DEFAULT_AXIS_X,
	SCATTER_DEFAULT_AXIS_Y,
} from "../src/encoding/scatter-axis-defaults";
import type { EncodingBinding } from "../src/encoding/types";

// Nothing bound → both sides get the quantitative defaults, enabled + linear.
{
	const { x, y } = scatterAxisDefaults(undefined, undefined);
	ok(x.channelId === "axisX" && x.fieldId === SCATTER_DEFAULT_AXIS_X, "x defaults to degree");
	ok(y.channelId === "axisY" && y.fieldId === SCATTER_DEFAULT_AXIS_Y, "y defaults to ageDays");
	ok(x.enabled === true && y.enabled === true, "both default axes are enabled");
	ok(x.scale?.type === "linear" && y.scale?.type === "linear", "defaults use the linear scale");
}

// A user's enabled binding wins and is passed through verbatim (scale included).
{
	const userX: EncodingBinding = {
		channelId: "axisX",
		fieldId: "inDegree",
		scale: { type: "log" },
		enabled: true,
	};
	const { x, y } = scatterAxisDefaults(userX, undefined);
	ok(x === userX, "enabled user X binding is returned unchanged");
	ok(x.fieldId === "inDegree" && x.scale?.type === "log", "user X field + scale preserved");
	ok(y.fieldId === SCATTER_DEFAULT_AXIS_Y, "unbound Y still defaults");
}

// A disabled binding counts as unbound → replaced by the default (axes always on).
{
	const disabledY: EncodingBinding = {
		channelId: "axisY",
		fieldId: "maturity",
		enabled: false,
	};
	const { y } = scatterAxisDefaults(undefined, disabledY);
	ok(y.fieldId === SCATTER_DEFAULT_AXIS_Y && y.enabled === true, "disabled Y is replaced by default");
}

// Pure: inputs are not mutated.
{
	const userX: EncodingBinding = { channelId: "axisX", fieldId: "degree", enabled: true };
	scatterAxisDefaults(userX, undefined);
	ok(userX.fieldId === "degree" && userX.scale === undefined, "input binding left untouched");
}
