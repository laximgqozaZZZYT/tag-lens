// Pure, DOM-free helpers for the PNG export feature. Kept out of view.ts so the
// filename + dimension-clamping logic stays unit-testable in Node (test/run.mjs).

// Browsers cap a single canvas dimension (Safari tops out near 16384 px/side).
// Stay under it so toBlob() never returns a blank/failed bitmap.
export const MAX_EXPORT_DIM = 16384;

function pad2(n: number): string {
	return n < 10 ? `0${n}` : `${n}`;
}

// `tag-lens-<mode>-YYYYMMDD-HHmmss`. The mode is slugified so a label like
// "Icon Gallery" becomes "icon-gallery" and can never break a vault path. The
// extension is added by the callers below.
function stampedBase(mode: string, d: Date): string {
	const slug =
		mode
			.trim()
			.toLowerCase()
			.replace(/[^a-z0-9]+/g, "-")
			.replace(/^-+|-+$/g, "") || "view";
	const stamp =
		`${d.getFullYear()}${pad2(d.getMonth() + 1)}${pad2(d.getDate())}` +
		`-${pad2(d.getHours())}${pad2(d.getMinutes())}${pad2(d.getSeconds())}`;
	return `tag-lens-${slug}-${stamp}`;
}

// `tag-lens-<mode>-YYYYMMDD-HHmmss.png` (raster export).
export function exportFileName(mode: string, d: Date): string {
	return `${stampedBase(mode, d)}.png`;
}

// `tag-lens-<mode>-YYYYMMDD-HHmmss.svg` (vector export, F3). Distinct extension
// so SVG and PNG exports of the same view never collide.
export function svgFileName(mode: string, d: Date): string {
	return `${stampedBase(mode, d)}.svg`;
}

// Clamp the requested supersample so neither side exceeds the canvas limit.
// Returns the final integer pixel dims AND the (possibly reduced) effective
// scale, so the caller can drive the device-pixel-ratio multiplier by the SAME
// factor — keeping framing identical and only raising resolution.
export function exportCanvasDims(
	srcW: number,
	srcH: number,
	scale: number,
	maxDim: number = MAX_EXPORT_DIM,
): { width: number; height: number; scale: number } {
	const s = Math.max(0.1, scale);
	const longest = Math.max(srcW, srcH);
	const eff = longest * s > maxDim ? maxDim / longest : s;
	return {
		width: Math.max(1, Math.round(srcW * eff)),
		height: Math.max(1, Math.round(srcH * eff)),
		scale: eff,
	};
}
