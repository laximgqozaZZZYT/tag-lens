import type { AxisBand, AxisSpec, AxisTick } from "./axis-layout";

// Re-anchor an axis spec into world space by subtracting `offset` from every
// positional field. `axisLayout` produces positions in a [0, size] figure box;
// the card modes then centre the figure on the world origin (positions get
// `- cx` / `- cy`), so the axis bands/ticks must shift by the same amount to
// stay aligned with the dots. Pure + non-mutating: the input spec and its
// bands/ticks are cloned, so the caller's `axes.x`/`axes.y` are never touched.
export function shiftAxisSpec(spec: AxisSpec | undefined, offset: number): AxisSpec | undefined {
	if (!spec) return undefined;
	const out: AxisSpec = { ...spec };
	if (out.bands) {
		out.bands = out.bands.map(
			(b: AxisBand): AxisBand => ({
				...b,
				start: b.start - offset,
				end: b.end - offset,
				center: b.center - offset,
			}),
		);
	}
	if (out.ticks) {
		out.ticks = out.ticks.map((t: AxisTick): AxisTick => ({ ...t, pos: t.pos - offset }));
	}
	return out;
}
