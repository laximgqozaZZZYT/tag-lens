// L2 — pure note-navigator panel geometry (extracted from view.ts ensureNoteMenu).
// Asserts the rect priority/clamp and the pinned-width clamp behave exactly as
// the old inline math did.
import { ok } from "./assert";
import { defaultMenuRect, resolveMenuRect, clampPinnedWidth, noteMenuPanelStyle, noteMenuHeadStyle, noteMenuTabButtonStyle, noteMenuTitleButtons, noteMenuTitleRowStyle, noteMenuBodyPanelStyle, NOTE_MENU_MIN } from "../src/interaction/note-menu-geom";
import type { MenuRect } from "../src/interaction/note-menu";

// defaultMenuRect: top-left, 320 wide, ~full container height, never below min.
{
	const d = defaultMenuRect(600);
	ok(d.left === 8 && d.top === 8, `default at (8,8) (got ${d.left},${d.top})`);
	ok(d.width === 320, `default width 320 (got ${d.width})`);
	ok(d.height === 584, `default height = H-16 (got ${d.height})`);
	ok(defaultMenuRect(0).height === Math.max(NOTE_MENU_MIN.height, 600 - 16), "0 container falls back to 600");
	ok(defaultMenuRect(100).height === NOTE_MENU_MIN.height, "tiny container floored to min height");
}

// resolveMenuRect priority 1: savedRect wins over settings + default.
{
	const saved: MenuRect = { left: 50, top: 60, width: 300, height: 400 };
	const settings: MenuRect = { left: 1, top: 1, width: 200, height: 200 };
	const r = resolveMenuRect(saved, settings, { width: 1000, height: 800 });
	ok(r.left === 50 && r.top === 60 && r.width === 300 && r.height === 400, "savedRect wins (within bounds)");
}

// priority 2: no saved → settingsRect (copied, not aliased).
{
	const settings: MenuRect = { left: 20, top: 30, width: 250, height: 350 };
	const r = resolveMenuRect(null, settings, { width: 1000, height: 800 });
	ok(r.left === 20 && r.width === 250 && r.height === 350, "settingsRect used when no saved");
	ok(r !== settings, "result is a copy, not the settings object");
}

// priority 3: neither → default for the container height.
{
	const r = resolveMenuRect(null, null, { width: 1000, height: 700 });
	ok(r.left === 8 && r.width === 320 && r.height === 684, "default used when nothing saved");
}

// clamp ON when container known: oversized rect shrinks to container.
{
	const huge: MenuRect = { left: -9999, top: 9999, width: 5000, height: 5000 };
	const r = resolveMenuRect(huge, null, { width: 400, height: 300 });
	ok(r.width === 400 && r.height === 300, "size clamped to container");
	ok(r.left >= 40 - r.width && r.left <= 400 - 40, "left kept on-screen");
	ok(r.top >= 0 && r.top <= 300 - 40, "top kept on-screen");
}

// clamp OFF when container size unknown (pre-paint): seed returned verbatim.
{
	const seed: MenuRect = { left: -100, top: -100, width: 9999, height: 9999 };
	const r = resolveMenuRect(seed, null, { width: 0, height: 0 });
	ok(r.left === -100 && r.width === 9999 && r.height === 9999, "no clamp when container is 0×0");
}

// clampPinnedWidth: configured width, floored to min, ceilinged to 80% of container.
{
	ok(clampPinnedWidth(320, 1000) === 320, "uses configured width when within 80%");
	ok(clampPinnedWidth(900, 1000) === 800, "ceilinged to 80% of container (got " + clampPinnedWidth(900, 1000) + ")");
	ok(clampPinnedWidth(50, 1000) === NOTE_MENU_MIN.width, "floored to min width");
	ok(clampPinnedWidth(undefined, 1000) === 320, "default 320 when unset");
	ok(clampPinnedWidth(320, 0) === 256, "0 container → 80% of the 320 fallback (got " + clampPinnedWidth(320, 0) + ")");
}

// noteMenuPanelStyle: pinned docks to the right edge (fixed width, square left border);
// floating is a positioned box at the rect with rounded corners.
{
	const rect: MenuRect = { left: 12, top: 34, width: 300, height: 400 };
	const pinned = noteMenuPanelStyle(true, rect, 256);
	ok(pinned.position === "absolute", "pinned is absolutely positioned");
	ok(pinned.right === "0" && pinned.left === "" && pinned.top === "0" && pinned.bottom === "0", "pinned docks right, full height");
	ok(pinned.width === "256px", "pinned width = pinnedWidth px");
	ok(pinned.height === "" , "pinned height unset (full-height via top/bottom)");
	ok(pinned.border === "none" && pinned.borderLeft === "1px solid var(--background-modifier-border)", "pinned: left border only");
	ok(pinned.borderRadius === "0", "pinned: square corners");

	const floating = noteMenuPanelStyle(false, rect, 256);
	ok(floating.left === "12px" && floating.top === "34px" && floating.right === "" && floating.bottom === "", "floating positioned at rect");
	ok(floating.width === "300px" && floating.height === "400px", "floating sized to rect");
	ok(floating.border === "1px solid var(--background-modifier-border)" && floating.borderRadius === "6px", "floating: full border + rounded");
	ok(floating.boxShadow === "0 4px 16px rgba(0,0,0,0.5)", "floating drop shadow");
	// Shared chrome on both looks.
	ok(pinned.background === "var(--background-secondary)" && floating.background === "var(--background-secondary)", "shared background");
	ok(pinned.zIndex === "60" && floating.zIndex === "60", "shared z-index");
}

// noteMenuHeadStyle: cursor is the only difference — move when floating (drag handle),
// default when pinned (docked, immovable).
{
	ok(noteMenuHeadStyle(false).cursor === "move", "floating header is a drag handle");
	ok(noteMenuHeadStyle(true).cursor === "default", "pinned header is not draggable");
	ok(noteMenuHeadStyle(true).flex === "0 0 auto", "header does not stretch");
}

// noteMenuTabButtonStyle: active gets the accent underline + emphasised text;
// inactive is transparent + muted. Padding/fontSize come from the size param so
// the same builder serves both the top-level bar and the Data sub-tab bar.
{
	const sz = { padding: "4px 8px", fontSize: "10.5px" };
	const on = noteMenuTabButtonStyle(true, sz);
	ok(on.borderBottom === "2px solid var(--interactive-accent)", "active: accent underline");
	ok(on.color === "var(--text-normal)" && on.fontWeight === "600", "active: emphasised text");
	const off = noteMenuTabButtonStyle(false, sz);
	ok(off.borderBottom === "2px solid transparent", "inactive: transparent underline");
	ok(off.color === "var(--text-muted)" && off.fontWeight === "400", "inactive: muted text");
	ok(on.padding === "4px 8px" && on.fontSize === "10.5px", "size param flows through");
	ok(on.background === "transparent" && on.border === "none" && on.borderRadius === "0", "shared chrome");
	// A different size param (top-level bar) flows through unchanged.
	const big = noteMenuTabButtonStyle(true, { padding: "6px 14px", fontSize: "11px" });
	ok(big.padding === "6px 14px" && big.fontSize === "11px", "top-level size param flows through");
}

// noteMenuTitleButtons: the pin button flips icon/colour/label with `pinned`;
// the close button is static. Both carry an accessible label.
{
	const p = noteMenuTitleButtons(true);
	ok(p.pin.icon === "pin-off", "pinned: pin-off icon");
	ok(p.pin.ariaLabel === "Unpin (float)", "pinned: unpin label");
	ok(p.pin.style.color === "var(--interactive-accent)", "pinned: accent colour");
	const f = noteMenuTitleButtons(false);
	ok(f.pin.icon === "pin", "floating: pin icon");
	ok(f.pin.ariaLabel === "Pin to right", "floating: pin label");
	ok(f.pin.style.color === "var(--text-muted)", "floating: muted colour");
	// Close is identical regardless of pin state.
	ok(p.close.ariaLabel === "Close menu" && f.close.ariaLabel === "Close menu", "close label static");
	ok(p.close.icon === undefined, "close has no lucide icon (uses × glyph)");
	ok(p.close.style.fontWeight === "700" && p.close.style.fontSize === "16px", "close glyph styling");
}

// noteMenuTitleRowStyle: two static layout blocks — the row (space-between, name
// left / buttons right, centred) and the right-aligned button group (no shrink).
{
	const t = noteMenuTitleRowStyle();
	ok(t.row.display === "flex" && t.row.justifyContent === "space-between", "row: space-between flex");
	ok(t.row.alignItems === "center" && t.row.gap === "8px", "row: centred, 8px gap");
	ok(t.btns.display === "flex" && t.btns.alignItems === "center", "btns: centred flex");
	ok(t.btns.gap === "2px" && t.btns.flex === "0 0 auto", "btns: 2px gap, no shrink");
}

// noteMenuBodyPanelStyle: scroll panes get overflow:auto + content padding; column
// wrappers nest further panes (flexDirection:column, no scroll/padding). Both fill
// the remaining height; `display` carries the show/hide state.
{
	const scroll = noteMenuBodyPanelStyle("scroll", "block");
	ok(scroll.display === "block", "scroll: display flows through");
	ok(scroll.overflow === "auto" && scroll.padding === "4px 6px 8px", "scroll: scrollable + padded");
	ok(scroll.flex === "1 1 auto" && scroll.minHeight === "0", "scroll: fills remaining height");
	ok(scroll.flexDirection === undefined, "scroll: no flex-direction");

	const hidden = noteMenuBodyPanelStyle("scroll", "none");
	ok(hidden.display === "none", "scroll hidden: display none");

	const column = noteMenuBodyPanelStyle("column", "none");
	ok(column.display === "none", "column: display flows through");
	ok(column.flexDirection === "column", "column: stacks children");
	ok(column.flex === "1 1 auto" && column.minHeight === "0", "column: fills remaining height");
	ok(column.overflow === undefined && column.padding === undefined, "column: no scroll/padding (nests panes)");
}
