// Clamp a value into the unit interval `[0, 1]`.
//
// The `Math.max(0, Math.min(1, t))` idiom — clamping a normalized interpolation
// / colour parameter `t` before it indexes a ramp — was re-derived inline across
// several modules: the quantitative scale normalizer (`encoding/scales.ts`), the
// legend gradient sampler (`draw/legend-layout.ts` `rampColorAt`), the shared
// sequential colour ramp (`draw/legend-spec.ts` `sequentialColorRamp`), and a
// local `clamp01` in `draw/mode-legend.ts`. This centralizes that one rule.
// Sibling of `clampScroll` (floors at 0, ceils at an explicit `max`) and
// `clampZoom` — this is the fixed `[0, 1]` case.
export function clamp01(n: number): number {
	return Math.max(0, Math.min(1, n));
}
