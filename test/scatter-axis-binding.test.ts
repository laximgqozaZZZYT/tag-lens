// Scatter axis-picker binding bridge (F2.6b). Locks: the picker reads the user's
// enabled axisX/axisY binding (else the scatter default), and writing back
// upserts an enabled binding without disturbing other channels or mutating input.
import { ok } from "./assert";
import {
	scatterAxisSelection,
	setScatterAxisBinding,
} from "../src/panel/scatter-axis-binding";
import {
	SCATTER_DEFAULT_AXIS_X,
	SCATTER_DEFAULT_AXIS_Y,
} from "../src/encoding/scatter-axis-defaults";
import type { EncodingBinding } from "../src/encoding/types";

// Empty encoding → both axes seed from the scatter defaults (degree/ageDays, linear).
{
	const sel = scatterAxisSelection([]);
	ok(sel.x.fieldId === SCATTER_DEFAULT_AXIS_X, "empty → default X field");
	ok(sel.y.fieldId === SCATTER_DEFAULT_AXIS_Y, "empty → default Y field");
	ok(sel.x.scale === "linear" && sel.y.scale === "linear", "empty → linear scales");
}

// A user's enabled binding wins, scale narrowed to the quantitative subset.
{
	const enc: EncodingBinding[] = [
		{ channelId: "axisX", fieldId: "ageDays", scale: { type: "log" }, enabled: true },
	];
	const sel = scatterAxisSelection(enc);
	ok(sel.x.fieldId === "ageDays", "bound X field wins");
	ok(sel.x.scale === "log", "bound X scale wins");
	ok(sel.y.fieldId === SCATTER_DEFAULT_AXIS_Y, "unbound Y falls back to default");
}

// A disabled binding is ignored (matches scatterAxisDefaults / the plot).
{
	const enc: EncodingBinding[] = [
		{ channelId: "axisX", fieldId: "ageDays", scale: { type: "log" }, enabled: false },
	];
	const sel = scatterAxisSelection(enc);
	ok(sel.x.fieldId === SCATTER_DEFAULT_AXIS_X, "disabled binding → default field");
	ok(sel.x.scale === "linear", "disabled binding → default scale");
}

// A non-quantitative scale narrows to linear when seeding the picker.
{
	const enc: EncodingBinding[] = [
		{ channelId: "axisY", fieldId: "degree", scale: { type: "ordinal" }, enabled: true },
	];
	const sel = scatterAxisSelection(enc);
	ok(sel.y.scale === "linear", "non-quantitative scale narrows to linear");
}

// setScatterAxisBinding: changing only the field preserves the current scale.
{
	const enc: EncodingBinding[] = [
		{ channelId: "axisX", fieldId: "degree", scale: { type: "log" }, enabled: true },
	];
	const next = setScatterAxisBinding(enc, "axisX", { fieldId: "ageDays" });
	const bx = next.find((b) => b.channelId === "axisX")!;
	ok(bx.fieldId === "ageDays", "field updated");
	ok(bx.scale?.type === "log", "scale preserved when only field changes");
	ok(bx.enabled === true, "binding enabled");
}

// Changing only the scale preserves the current field.
{
	const enc: EncodingBinding[] = [
		{ channelId: "axisY", fieldId: "degree", scale: { type: "linear" }, enabled: true },
	];
	const next = setScatterAxisBinding(enc, "axisY", { scale: "quantile" });
	const by = next.find((b) => b.channelId === "axisY")!;
	ok(by.fieldId === "degree", "field preserved when only scale changes");
	ok(by.scale?.type === "quantile", "scale updated");
}

// Upsert creates the binding when absent and leaves other channels untouched.
{
	const enc: EncodingBinding[] = [
		{ channelId: "color", fieldId: "maturity", enabled: true },
	];
	const next = setScatterAxisBinding(enc, "axisX", { fieldId: "degree", scale: "linear" });
	ok(next.some((b) => b.channelId === "axisX"), "axisX binding created");
	ok(
		next.find((b) => b.channelId === "color")?.fieldId === "maturity",
		"unrelated colour binding untouched",
	);
	// Input array + members not mutated.
	ok(enc.length === 1 && enc[0].channelId === "color", "input array not mutated");
}
