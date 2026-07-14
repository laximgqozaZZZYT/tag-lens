// Scatter axis-picker option lists (F2.6). Locks: X/Y attribute options are
// exactly the quantitative field sources, the scatter axis defaults appear in
// them, and the scale options are the three quantitative scales in order.
import { ok } from "./assert";
import {
	scatterAxisFieldOptions,
	scatterAxisScaleOptions,
	type ScatterAxisScale,
} from "../src/panel/scatter-axis-options";
import {
	SCATTER_DEFAULT_AXIS_X,
	SCATTER_DEFAULT_AXIS_Y,
} from "../src/encoding/scatter-axis-defaults";
import { listFieldSources } from "../src/encoding/field-sources";

{
	const fields = scatterAxisFieldOptions();
	ok(fields.length > 0, "at least one quantitative field option");

	// Exactly the quantitative field sources (value=id, in registration order).
	const expected = listFieldSources().filter((f) => f.kind === "quantitative");
	ok(fields.length === expected.length, "one option per quantitative field");
	for (let i = 0; i < fields.length; i++) {
		ok(fields[i].value === expected[i].id, `option ${i} value matches field id`);
		ok(fields[i].label === expected[i].label, `option ${i} label matches field label`);
	}

	// No categorical/temporal leak in.
	const values = fields.map((o) => o.value);
	ok(!values.includes("maturity"), "categorical field excluded");
	ok(!values.includes("tag"), "categorical tag field excluded");

	// The scatter defaults are selectable in the picker.
	ok(values.includes(SCATTER_DEFAULT_AXIS_X), "default X attr is an option");
	ok(values.includes(SCATTER_DEFAULT_AXIS_Y), "default Y attr is an option");
}

{
	const scales = scatterAxisScaleOptions();
	const vals: ScatterAxisScale[] = scales.map((s) => s.value);
	ok(vals.join(",") === "linear,log,quantile", `scale options in order (${vals.join(",")})`);
	ok(
		scales.map((s) => s.label).join("|") === "Linear|Log|Quantile",
		"scale labels match",
	);
}
