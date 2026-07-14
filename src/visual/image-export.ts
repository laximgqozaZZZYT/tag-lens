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

// `exportCanvasDims` silently reduces the requested supersample when a side
// would exceed the canvas cap (e.g. 4× → 2.7×). Surface that to the user as a
// Notice. Returns the message when the effective scale fell below the requested
// one (beyond a float-rounding epsilon), else null (framing unchanged → no
// notice). Centralizes the epsilon + the `.toFixed(1)` format so the view just
// shows whatever string it gets back.
export function exportScaleCapMessage(
	requestedScale: number,
	effectiveScale: number,
): string | null {
	if (effectiveScale >= requestedScale - 1e-6) return null;
	return `Tag Lens: export limited to ${effectiveScale.toFixed(1)}× (canvas size cap).`;
}

// The export-menu action a menu item triggers, as a plain data descriptor so
// the wiring (which method to call, with which opts) is decided by pure code
// rather than being duplicated across each `menu.addItem` closure in view.ts.
type ExportMenuAction =
	| { format: "png"; scale: number; fit: boolean; target: "vault" | "clipboard" }
	| { format: "svg"; fit: boolean; target: "vault" | "clipboard" };

// One entry in the "Export view" menu: either a visual separator or a titled,
// iconed item carrying the action it performs. The view maps `item` entries to
// `menu.addItem(...)` (wiring the icon/title + onClick from `action`) and
// `separator` entries to `menu.addSeparator()`.
export type ExportMenuEntry = { kind: "separator" } | ({ kind: "item"; title: string; icon: string } & { action: ExportMenuAction });

// The full, ordered export-menu descriptor list: raster (PNG) copy/save/whole
// options, a separator, then the vector (SVG) copy/save/whole options. Pure and
// stateless — the view only translates it into Obsidian `Menu` calls.
export function exportMenuItems(): ExportMenuEntry[] {
	return [
		{ kind: "item", title: "Copy view to clipboard", icon: "copy", action: { format: "png", scale: 2, fit: false, target: "clipboard" } },
		{ kind: "item", title: "Save view as PNG (2×)", icon: "image-down", action: { format: "png", scale: 2, fit: false, target: "vault" } },
		{ kind: "item", title: "Save view as PNG (4×)", icon: "image-down", action: { format: "png", scale: 4, fit: false, target: "vault" } },
		{ kind: "item", title: "Save whole figure as PNG (2×)", icon: "maximize", action: { format: "png", scale: 2, fit: true, target: "vault" } },
		{ kind: "separator" },
		{ kind: "item", title: "Copy view as SVG", icon: "copy", action: { format: "svg", fit: false, target: "clipboard" } },
		{ kind: "item", title: "Save view as SVG", icon: "file-code", action: { format: "svg", fit: false, target: "vault" } },
		{ kind: "item", title: "Save whole figure as SVG", icon: "maximize", action: { format: "svg", fit: true, target: "vault" } },
	];
}
