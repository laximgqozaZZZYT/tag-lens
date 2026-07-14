// PNG-export pure-helper tests: filename slug/stamp formatting and the
// dimension-clamping that keeps an export under the browser canvas limit.
import { ok } from "./assert";
import {
	exportFileName,
	svgFileName,
	exportCanvasDims,
	exportScaleCapMessage,
	MAX_EXPORT_DIM,
	exportMenuItems,
} from "../src/visual/image-export";

// filename: slugifies the mode label and zero-pads every stamp field.
// (Date month is 0-based, so 5 -> June.)
{
	const d = new Date(2026, 5, 8, 9, 3, 7);
	ok(
		exportFileName("Icon Gallery", d) === "tag-lens-icon-gallery-20260608-090307.png",
		"exportFileName slugifies mode and zero-pads the stamp",
	);
}
{
	const d = new Date(2026, 11, 31, 23, 59, 59);
	ok(
		exportFileName("lattice", d) === "tag-lens-lattice-20261231-235959.png",
		"exportFileName handles December and full-width fields",
	);
}
{
	const d = new Date(2026, 0, 1, 0, 0, 0);
	ok(
		exportFileName("   ", d).startsWith("tag-lens-view-"),
		"exportFileName falls back to 'view' for an empty mode",
	);
}

// svgFileName: same slug/stamp as PNG but a .svg extension (no .png collision).
{
	const d = new Date(2026, 5, 8, 9, 3, 7);
	ok(
		svgFileName("Icon Gallery", d) === "tag-lens-icon-gallery-20260608-090307.svg",
		"svgFileName shares the slug/stamp and uses .svg",
	);
	ok(svgFileName("euler", d).endsWith(".svg"), "svgFileName ends with .svg (not .png)");
	ok(svgFileName("   ", d).startsWith("tag-lens-view-"), "svgFileName falls back to 'view'");
}

// dims: pass straight through when the result fits under the cap.
{
	const r = exportCanvasDims(1000, 600, 2);
	ok(r.width === 2000 && r.height === 1200 && r.scale === 2, "dims scale through under the cap");
}
// dims: clamp the longest side to the cap and report the reduced scale,
// preserving aspect ratio so framing is untouched.
{
	const r = exportCanvasDims(10000, 5000, 4, MAX_EXPORT_DIM);
	ok(r.width === MAX_EXPORT_DIM, "dims clamp the longest side to the cap");
	ok(Math.abs(r.scale - MAX_EXPORT_DIM / 10000) < 1e-9, "dims report the reduced scale");
	ok(r.height === Math.round(5000 * r.scale), "dims preserve aspect ratio when clamped");
}

// export menu: the ordered descriptor list matches the old inline menu — four
// PNG items, a separator, then three SVG items — with the exact title/icon/action.
{
	const items = exportMenuItems();
	ok(items.length === 8, "exportMenuItems returns 8 entries (7 items + 1 separator)");
	// Exactly one separator, sitting between the PNG block and the SVG block.
	const sepIdx = items.findIndex((e) => e.kind === "separator");
	ok(sepIdx === 4, "the separator sits after the four PNG items");
	ok(
		items.filter((e) => e.kind === "separator").length === 1,
		"there is exactly one separator",
	);
	const pngs = items.filter((e) => e.kind === "item" && e.action.format === "png");
	const svgs = items.filter((e) => e.kind === "item" && e.action.format === "svg");
	ok(pngs.length === 4 && svgs.length === 3, "four PNG items and three SVG items");
	// Every PNG item before the separator, every SVG item after it.
	ok(
		items.every((e, i) =>
			e.kind !== "item" || (e.action.format === "png") === i < sepIdx,
		),
		"PNG items precede the separator, SVG items follow it",
	);
	// Spot-check the first (copy PNG) and last (whole-figure SVG) exactly.
	const first = items[0];
	ok(
		first.kind === "item" &&
			first.title === "Copy view to clipboard" &&
			first.icon === "copy" &&
			first.action.format === "png" &&
			first.action.scale === 2 &&
			first.action.fit === false &&
			first.action.target === "clipboard",
		"first item copies a 2× non-fit PNG to the clipboard",
	);
	const last = items[items.length - 1];
	ok(
		last.kind === "item" &&
			last.title === "Save whole figure as SVG" &&
			last.icon === "maximize" &&
			last.action.format === "svg" &&
			last.action.fit === true &&
			last.action.target === "vault",
		"last item saves the whole figure as SVG to the vault",
	);
	// The 4× PNG is the only scale-4 entry.
	const x4 = items.filter((e) => e.kind === "item" && e.action.format === "png" && e.action.scale === 4);
	ok(
		x4.length === 1 && x4[0].kind === "item" && x4[0].title === "Save view as PNG (4×)",
		"exactly one 4× PNG item",
	);
}

// exportScaleCapMessage: null when the export kept the requested scale (framing
// unchanged), and a formatted "limited to N×" notice when the cap reduced it.
{
	ok(
		exportScaleCapMessage(2, 2) === null,
		"no notice when the effective scale equals the requested scale",
	);
	// A float-rounding wobble under the requested scale is still "no cap".
	ok(
		exportScaleCapMessage(4, 4 - 1e-9) === null,
		"no notice within the rounding epsilon of the requested scale",
	);
	// A real reduction (10000px side capped at 16384 → ~1.6×) surfaces the notice.
	const capped = exportCanvasDims(10000, 5000, 4, MAX_EXPORT_DIM);
	const msg = exportScaleCapMessage(4, capped.scale);
	ok(
		msg === `Tag Lens: export limited to ${capped.scale.toFixed(1)}× (canvas size cap).`,
		"a reduced scale yields the size-cap notice with the effective scale",
	);
	// The reported number is the EFFECTIVE (reduced) scale, to one decimal.
	ok(
		exportScaleCapMessage(4, 2.66) === "Tag Lens: export limited to 2.7× (canvas size cap).",
		"the notice rounds the effective scale to one decimal",
	);
}
