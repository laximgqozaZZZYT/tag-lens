// Compact number formatting for legend labels: round to 2 decimals, normalize a
// rounded -0 to "0", and render a non-finite value as an em-dash so a missing/NaN
// count reads as "no value" rather than "NaN". Shared by the mode-intrinsic legend
// (mode-legend.ts) and the encoding legend (legend-spec.ts) so both agree.
export function formatLegendNumber(n: number): string {
	if (!Number.isFinite(n)) return "—";
	const r = Math.round(n * 100) / 100;
	return Object.is(r, -0) ? "0" : String(r);
}
