// L2 — pure view-shell chrome (extracted from view.ts onOpen). Locks the static
// root/canvas base styles so the inline setCssStyles blocks can't silently drift.
import { ok } from "./assert";
import { viewRootStyle, viewCanvasStyle } from "../src/view-shell-style";

// Root: no padding, clipped, positioning context for the note-menu overlay.
{
	const r = viewRootStyle();
	ok(r.padding === "0", `root padding 0 (got ${r.padding})`);
	ok(r.overflow === "hidden", `root overflow hidden (got ${r.overflow})`);
	ok(r.position === "relative", `root position relative (got ${r.position})`);
}

// Canvas: fills root, block (no inline baseline gap), grab cursor for panning.
{
	const c = viewCanvasStyle();
	ok(c.width === "100%" && c.height === "100%", `canvas fills root (got ${c.width}x${c.height})`);
	ok(c.display === "block", `canvas display block (got ${c.display})`);
	ok(c.cursor === "grab", `canvas grab cursor (got ${c.cursor})`);
}
