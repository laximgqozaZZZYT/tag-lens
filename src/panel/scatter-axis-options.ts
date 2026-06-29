// Scatter mode (F2.6) axis-picker option lists. Pure builders the future Scatter
// settings section consumes for its X/Y attribute + scale dropdowns; kept here
// (next to the other panel descriptor builders like basesEdgeKinds) so the option
// set and its single source of truth — the field-source registry + the scale
// types — stay in lockstep with the layout/encoding layer. No DOM, no Obsidian.
import { listFieldSources } from "../encoding/field-sources";
import type { ScaleConfig } from "../encoding/types";

export interface AxisFieldOption {
	value: string; // FieldSource id (binds to axisX/axisY fieldId)
	label: string;
}

// The bindable X/Y attributes for scatter: the quantitative field sources only
// (a scatter axis is a number line). Order mirrors registration order. The
// scatter defaults (degree / ageDays) are always present here.
export function scatterAxisFieldOptions(): AxisFieldOption[] {
	return listFieldSources()
		.filter((f) => f.kind === "quantitative")
		.map((f) => ({ value: f.id, label: f.label }));
}

// The scale types a scatter axis can use. A subset of ScaleConfig["type"] — the
// quantitative scales only (categorical/ordinal don't make a continuous axis).
export type ScatterAxisScale = Extract<ScaleConfig["type"], "linear" | "log" | "quantile">;

export interface AxisScaleOption {
	value: ScatterAxisScale;
	label: string;
}

export function scatterAxisScaleOptions(): AxisScaleOption[] {
	return [
		{ value: "linear", label: "Linear" },
		{ value: "log", label: "Log" },
		{ value: "quantile", label: "Quantile" },
	];
}
