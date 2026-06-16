// PNG-export pure-helper tests: filename slug/stamp formatting and the
// dimension-clamping that keeps an export under the browser canvas limit.
import { ok } from "./assert";
import { exportFileName, svgFileName, exportCanvasDims, MAX_EXPORT_DIM } from "../src/visual/image-export";

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
