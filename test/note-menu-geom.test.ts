// L2 — pure note-navigator panel geometry (extracted from view.ts ensureNoteMenu).
// Asserts the rect priority/clamp and the pinned-width clamp behave exactly as
// the old inline math did.
import { ok } from "./assert";
import { defaultMenuRect, resolveMenuRect, clampPinnedWidth, NOTE_MENU_MIN } from "../src/interaction/note-menu-geom";
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
