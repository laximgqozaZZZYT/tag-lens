// L2 — pure note-navigator panel geometry (extracted from view.ts ensureNoteMenu).
// Asserts the rect priority/clamp and the pinned-width clamp behave exactly as
// the old inline math did.
import { ok } from "./assert";
import { defaultMenuRect, resolveMenuRect, clampPinnedWidth, noteMenuPanelStyle, noteMenuHeadStyle, noteMenuTabButtonStyle, noteMenuTabHoverStyle, noteMenuTitleButtons, noteMenuTitleRowStyle, noteMenuBulkBarStyle, noteMenuGroupBarStyle, noteMenuSearchStyle, noteMenuBodyPanelStyle, noteMenuTabBarStyle, noteMenuTopTabs, noteMenuDataSubTabs, noteMenuGroupOptions, noteMenuTopTabDisplay, noteMenuDataSubTabDisplay, noteMenuMinimizeDisplay, suggestionKindStyle, noteMenuSuggestStyle, noteMenuSuggestSelectionStyle, noteMenuLeftGripStyle, noteMenuBottomRightGripStyle, noteMenuNotesHint, noteMenuTreeRowStyle, noteMenuLeafHighlight, noteMenuLeafRowHoverStyle, noteMenuJsonLabelStyle, noteMenuJsonTextareaStyle, noteMenuJsonButtonRowStyle, noteMenuJsonTitleStyle, noteMenuJsonStatusStyle, noteMenuRectStyle, moveMenuRect, resizeMenuRect, NOTE_MENU_MIN } from "../src/interaction/note-menu-geom";
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

// noteMenuRectStyle: the floating rect → px mapping, shared by noteMenuPanelStyle's
// floating branch and every live drag/resize re-apply. Only the four position/size
// props, no chrome; matches the floating panel's rect props exactly.
{
	const rect: MenuRect = { left: 12, top: 34, width: 300, height: 400 };
	const s = noteMenuRectStyle(rect);
	ok(s.left === "12px" && s.top === "34px" && s.width === "300px" && s.height === "400px", "rect mapped to px strings");
	ok(Object.keys(s).length === 4, "only the four position/size props");
	// Can't drift from the floating panel's rect props.
	const floating = noteMenuPanelStyle(false, rect, 256);
	ok(floating.left === s.left && floating.top === s.top && floating.width === s.width && floating.height === s.height, "floating panel reuses the same rect mapping");
}

// moveMenuRect / resizeMenuRect: the two drag-delta rect transforms shared by
// wireNoteMenuDrag. move translates left/top (size fixed); resize grows
// width/height (position fixed). Both are pure (start untouched).
{
	const start: MenuRect = { left: 10, top: 20, width: 300, height: 400 };
	const moved = moveMenuRect(start, 5, -7);
	ok(moved.left === 15 && moved.top === 13, `move translates position (got ${moved.left},${moved.top})`);
	ok(moved.width === 300 && moved.height === 400, "move keeps the size");
	const resized = resizeMenuRect(start, 5, -7);
	ok(resized.left === 10 && resized.top === 20, "resize keeps the position");
	ok(resized.width === 305 && resized.height === 393, `resize grows the size (got ${resized.width}×${resized.height})`);
	// Zero delta is an identity clone; input never mutated.
	const id0 = moveMenuRect(start, 0, 0);
	ok(id0.left === 10 && id0.top === 20 && id0.width === 300 && id0.height === 400, "zero move = identity");
	ok(start.left === 10 && start.top === 20 && start.width === 300 && start.height === 400, "start untouched");
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

// noteMenuTabHoverStyle: the inactive-tab hover hint — muted text + a faint
// underline colour. Shared verbatim by both the top-level bar and the Data
// sub-bar mouseenter handlers (it sets only the two props the active style
// would otherwise own, leaving the rest of the button chrome untouched).
{
	const h = noteMenuTabHoverStyle();
	ok(h.color === "var(--text-muted)", "hover: muted text");
	ok(h.borderBottomColor === "var(--background-modifier-border)", "hover: faint underline");
	ok(Object.keys(h).length === 2, "hover: only the two hint props (no full chrome)");
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

// noteMenuTabBarStyle: the top bar has a small top gap + 11px text and no wrap;
// the sub bar wraps onto rows and is padded in from the edge. Both share the
// same bottom divider and are flex rows.
{
	const top = noteMenuTabBarStyle("top");
	ok(top.display === "flex" && top.gap === "2px", "top: flex row, 2px gap");
	ok(top.marginTop === "8px" && top.fontSize === "11px", "top: top gap + 11px text");
	ok(top.borderBottom === "1px solid var(--background-modifier-border)", "top: bottom divider");
	ok(top.flexWrap === undefined && top.padding === undefined, "top: no wrap / no padding");

	const sub = noteMenuTabBarStyle("sub");
	ok(sub.display === "flex" && sub.flexWrap === "wrap", "sub: wrapping flex row");
	ok(sub.gap === "1px" && sub.padding === "4px 6px 0", "sub: 1px gap, padded edge");
	ok(sub.borderBottom === "1px solid var(--background-modifier-border)", "sub: bottom divider");
	ok(sub.marginTop === undefined && sub.fontSize === undefined, "sub: no top gap / inherits font");

	// settings: like the Data sub bar (wrapping flex + 1px gap + divider) but spaced
	// below via marginBottom instead of the padded-in edge.
	const settings = noteMenuTabBarStyle("settings");
	ok(settings.display === "flex" && settings.flexWrap === "wrap", "settings: wrapping flex row");
	ok(settings.gap === "1px" && settings.marginBottom === "6px", "settings: 1px gap, 6px bottom gap");
	ok(settings.borderBottom === "1px solid var(--background-modifier-border)", "settings: bottom divider");
	ok(settings.padding === undefined && settings.marginTop === undefined, "settings: no edge padding / no top gap");
}

// noteMenuTopTabs / noteMenuDataSubTabs: descriptor lists drive both the button
// render order/labels and (via the key type) the persisted field values. Lock the
// keys + labels + order so a rename can't silently desync the strip from state.
{
	const top = noteMenuTopTabs();
	ok(top.map((t) => t.key).join(",") === "data,settings,insight", "top tabs: key order");
	ok(top.map((t) => t.label).join(",") === "Data,Settings,Insight", "top tabs: labels");

	const sub = noteMenuDataSubTabs();
	ok(sub.map((t) => t.key).join(",") === "logic,tree,table,json", "data sub-tabs: key order");
	ok(sub.map((t) => t.label).join(",") === "Logic,Tree,Table,JSON", "data sub-tabs: labels");
}

// noteMenuGroupOptions: the tree grouping-selector radios. Value type is the
// single source of truth for the persisted noteMenuGroupBy field; lock the
// values + labels + order (Folder is the default, so it must render first).
{
	const opts = noteMenuGroupOptions();
	ok(opts.map((o) => o.value).join(",") === "folder,tag", "group options: value order");
	ok(opts.map((o) => o.label).join(",") === "Folder,Tag", "group options: labels");
}

// noteMenuTopTabDisplay: exactly the active pane is visible; the Data wrapper
// reveals as "flex" (it nests sub-panes), Settings/Insight as "block".
{
	const d = noteMenuTopTabDisplay("data");
	ok(d.data === "flex" && d.settings === "none" && d.insight === "none", "data active → flex, others none");
	const s = noteMenuTopTabDisplay("settings");
	ok(s.settings === "block" && s.data === "none" && s.insight === "none", "settings active → block, others none");
	const i = noteMenuTopTabDisplay("insight");
	ok(i.insight === "block" && i.data === "none" && i.settings === "none", "insight active → block, others none");
}

// noteMenuDataSubTabDisplay: exactly the active sub-pane is visible; the Tree pane
// reveals as "flex" (it nests its own list), Logic/Table/JSON as "block".
{
	const l = noteMenuDataSubTabDisplay("logic");
	ok(l.logic === "block" && l.tree === "none" && l.table === "none" && l.json === "none", "logic active → block, others none");
	const t = noteMenuDataSubTabDisplay("tree");
	ok(t.tree === "flex" && t.logic === "none" && t.table === "none" && t.json === "none", "tree active → flex, others none");
	const tb = noteMenuDataSubTabDisplay("table");
	ok(tb.table === "block" && tb.logic === "none" && tb.tree === "none" && tb.json === "none", "table active → block, others none");
	const j = noteMenuDataSubTabDisplay("json");
	ok(j.json === "block" && j.logic === "none" && j.tree === "none" && j.table === "none", "json active → block, others none");
}

// noteMenuMinimizeDisplay: minimized hides body+grip; expanded restores the body
// to "flex" and the grip to its own default ("").
{
	const min = noteMenuMinimizeDisplay(true);
	ok(min.body === "none" && min.grip === "none", "minimized → body+grip hidden");
	const exp = noteMenuMinimizeDisplay(false);
	ok(exp.body === "flex" && exp.grip === "", "expanded → body flex, grip default");
}

// noteMenuBulkBarStyle: two static layout blocks — the row (small gap, top margin)
// and one bulk button (small muted secondary-background pill).
{
	const b = noteMenuBulkBarStyle();
	ok(b.bar.display === "flex" && b.bar.gap === "6px" && b.bar.marginTop === "4px", "bar: 6px-gap flex row, 4px top");
	ok(b.btn.fontSize === "10px" && b.btn.padding === "2px 6px" && b.btn.cursor === "pointer", "btn: small clickable pill");
	ok(b.btn.background === "var(--background-secondary)" && b.btn.color === "var(--text-muted)", "btn: muted secondary bg");
	ok(b.btn.border === "1px solid var(--background-modifier-border)" && b.btn.borderRadius === "3px", "btn: bordered, rounded");
	ok(b.btn.lineHeight === "1.4", "btn: line-height");
}

// noteMenuGroupBarStyle: the muted group-by radio row + one inline-flex radio label.
{
	const g = noteMenuGroupBarStyle();
	ok(g.bar.display === "flex" && g.bar.gap === "10px" && g.bar.marginTop === "4px", "bar: 10px-gap flex row, 4px top");
	ok(g.bar.fontSize === "11px" && g.bar.color === "var(--text-muted)" && g.bar.cursor === "default", "bar: muted 11px, default cursor");
	ok(g.label.display === "inline-flex" && g.label.alignItems === "center" && g.label.gap === "3px", "label: inline-flex centered 3px gap");
	ok(g.label.cursor === "pointer" && g.label.userSelect === "none", "label: pointer, no select");
}

// noteMenuSearchStyle: the tree-pane search wrapper / input / dropdown / body chrome.
{
	const s = noteMenuSearchStyle();
	ok(s.wrap.position === "relative" && s.wrap.margin === "6px 8px" && s.wrap.flex === "0 0 auto", "wrap: relative anchor, no grow");
	ok(s.input.display === "block" && s.input.width === "100%" && s.input.boxSizing === "border-box", "input: full-width block");
	ok(s.input.background === "var(--background-primary)" && s.input.color === "var(--text-normal)", "input: panel bg + normal text");
	ok(s.input.border === "1px solid var(--background-modifier-border)" && s.input.borderRadius === "4px", "input: bordered, rounded");
	ok(s.suggBox.position === "absolute" && s.suggBox.top === "100%" && s.suggBox.display === "none", "suggBox: pinned under input, hidden by default");
	ok(s.suggBox.zIndex === "70" && s.suggBox.maxHeight === "240px" && s.suggBox.overflow === "auto", "suggBox: above body, capped scroll");
	ok(s.body.overflow === "auto" && s.body.flex === "1 1 auto" && s.body.minHeight === "0", "body: grows/shrinks with panel");
}

// noteMenuNotesHint: faint note-count hint, verb flips with droste mode.
{
	const normal = noteMenuNotesHint(7, false);
	ok(normal.text === "7 notes — click to locate/open", `non-droste verb (got "${normal.text}")`);
	const droste = noteMenuNotesHint(3, true);
	ok(droste.text === "3 notes — click to focus", `droste verb (got "${droste.text}")`);
	ok(normal.style.fontSize === "10px" && normal.style.color === "var(--text-faint)" && normal.style.padding === "4px 8px 0", "hint: faint 10px chrome");
}

// suggestionKindStyle: glyph + accent colour per suggestion kind (tag/field/note).
{
	const tag = suggestionKindStyle("tag");
	ok(tag.glyph === "#" && tag.color === "var(--text-accent)", "tag: # / accent");
	const field = suggestionKindStyle("field");
	ok(field.glyph === "⊳" && field.color === "var(--color-purple)", "field: ⊳ / purple");
	const note = suggestionKindStyle("note");
	ok(note.glyph === "·" && note.color === "var(--text-muted)", "note: · / muted");
}

// noteMenuSuggestStyle: static chrome for a suggestion dropdown row + its glyph span.
{
	const s = noteMenuSuggestStyle();
	ok(s.row.display === "flex" && s.row.gap === "6px" && s.row.alignItems === "center", "row: flex, 6px gap, centred");
	ok(s.row.padding === "3px 8px" && s.row.cursor === "pointer", "row: padded, pointer");
	ok(s.row.whiteSpace === "nowrap" && s.row.overflow === "hidden" && s.row.textOverflow === "ellipsis", "row: single-line ellipsis");
	ok(s.glyph.width === "10px" && s.glyph.flex === "0 0 auto" && s.glyph.textAlign === "center", "glyph: fixed-width centred (colour applied per-kind)");
}

// noteMenuSuggestSelectionStyle: the selected suggestion row gets the modifier-border
// background; all others clear it (empty string resets to the row default).
{
	ok(noteMenuSuggestSelectionStyle(true).background === "var(--background-modifier-border)", "selected: modifier-border bg");
	ok(noteMenuSuggestSelectionStyle(false).background === "", "unselected: cleared bg");
}

// noteMenuLeftGripStyle: the pinned panel's thin transparent left-edge resize strip.
{
	const g = noteMenuLeftGripStyle();
	ok(g.position === "absolute" && g.left === "0" && g.top === "0" && g.bottom === "0", "grip: docked down the left border");
	ok(g.width === "6px" && g.cursor === "ew-resize", "grip: 6px ew-resize strip");
	ok(g.zIndex === "61" && g.background === "transparent", "grip: above body, transparent");
}

// noteMenuBottomRightGripStyle: the SE-corner invisible resize hit target.
{
	const g = noteMenuBottomRightGripStyle();
	ok(g.position === "absolute" && g.right === "0" && g.bottom === "0", "br grip: docked in the bottom-right corner");
	ok(g.width === "16px" && g.height === "16px" && g.cursor === "nwse-resize", "br grip: 16x16 nwse-resize target");
	ok(g.zIndex === "61" && g.background === "transparent", "br grip: above body, transparent");
}

// noteMenuTreeRowStyle: per-kind Tree-pane row + label chrome.
{
	const leaf = noteMenuTreeRowStyle("leaf", 2, "#2d6cdf55");
	ok(leaf.row.cursor === "pointer" && leaf.row.borderRadius === "3px", "leaf: pointer, rounded");
	ok(leaf.row.background === "#2d6cdf55", "leaf: dynamic highlight background passed through");
	ok(leaf.row.paddingLeft === `${6 + 2 * 12}px`, "leaf: depth indent (6 + depth*12)");
	// padding must precede paddingLeft so the indent is not overwritten.
	const leafKeys = Object.keys(leaf.row);
	ok(leafKeys.indexOf("padding") < leafKeys.indexOf("paddingLeft"), "leaf: padding emitted before paddingLeft");
	ok(leaf.label.flex === "1 1 auto" && leaf.label.textOverflow === "ellipsis" && !("cursor" in leaf.label), "leaf label: ellipsis, no cursor (row-click)");

	const folder = noteMenuTreeRowStyle("folder", 0);
	ok(folder.row.color === "var(--text-muted)" && folder.row.fontWeight === "600", "folder: muted, bold");
	ok(folder.row.paddingLeft === "6px" && !("borderRadius" in folder.row), "folder: base indent, no rounding");
	ok(folder.label.cursor === "pointer", "folder label: expand/collapse cursor");

	const all = noteMenuTreeRowStyle("all", 1);
	ok(all.row.color === "var(--text-faint)" && all.row.fontStyle === "italic", "all: faint, italic");
	ok(all.row.paddingLeft === `${26 + 1 * 12}px`, "all: extra checkbox-width indent (26 + depth*12)");
	ok(all.label.cursor === "pointer", "all label: collapse cursor");
}

// noteMenuLeafHighlight: the "current note" leaf-row highlight (accent wash +
// yellow label); rowBg is also what mouseleave restores to.
{
	const on = noteMenuLeafHighlight(true);
	ok(on.rowBg === "#2d6cdf55", "highlight on: translucent accent wash (matches draw/theme accent + alpha)");
	ok(on.labelColor === "var(--color-yellow)", "highlight on: yellow label");
	// rowBg feeds noteMenuTreeRowStyle's baseBg, so it must round-trip into the leaf row.
	ok(noteMenuTreeRowStyle("leaf", 0, on.rowBg).row.background === "#2d6cdf55", "highlight on: rowBg threads into leaf row background");

	const off = noteMenuLeafHighlight(false);
	ok(off.rowBg === "", "highlight off: no background wash");
	ok(off.labelColor === undefined, "highlight off: no label-colour override");
}

// noteMenuLeafRowHoverStyle: mouseenter → modifier-border wash; mouseleave →
// restore to the passed rowBg (either the current-note highlight or "").
{
	ok(noteMenuLeafRowHoverStyle(true, "").background === "var(--background-modifier-border)", "hover on: modifier-border wash");
	ok(noteMenuLeafRowHoverStyle(true, "#2d6cdf55").background === "var(--background-modifier-border)", "hover on: wash wins over rowBg");
	ok(noteMenuLeafRowHoverStyle(false, "").background === "", "hover off (plain row): cleared bg");
	ok(noteMenuLeafRowHoverStyle(false, "#2d6cdf55").background === "#2d6cdf55", "hover off (current note): restores highlight rowBg");
}

// Data ▸ JSON tab chrome: label margin and textarea height are params; the rest
// is shared between the export and import occurrences.
{
	const expL = noteMenuJsonLabelStyle("4px 0 2px");
	const impL = noteMenuJsonLabelStyle("12px 0 2px");
	ok(expL.fontSize === "11px" && expL.fontWeight === "600", "json label: 11px bold");
	ok(expL.margin === "4px 0 2px" && impL.margin === "12px 0 2px", "json label: margin is the only difference");

	const expTa = noteMenuJsonTextareaStyle("110px");
	const impTa = noteMenuJsonTextareaStyle("90px");
	ok(expTa.width === "100%" && expTa.fontFamily === "var(--font-monospace, monospace)", "json textarea: full-width mono");
	ok(expTa.fontSize === "10px" && expTa.resize === "vertical" && expTa.boxSizing === "border-box", "json textarea: 10px vertical-resize border-box");
	ok(expTa.height === "110px" && impTa.height === "90px", "json textarea: height is the only difference");

	const row = noteMenuJsonButtonRowStyle();
	ok(row.display === "flex" && row.gap === "6px" && row.marginTop === "4px", "json button row: flex, 6px gap, 4px top");

	const title = noteMenuJsonTitleStyle();
	ok(title.fontWeight === "600" && title.fontSize === "12px" && title.marginBottom === "6px", "json title: 12px bold, 6px below");

	// Status block: the summary line flips to a warning colour only when there
	// are errors; the per-error/overflow lines are static.
	const clean = noteMenuJsonStatusStyle(false);
	const dirty = noteMenuJsonStatusStyle(true);
	ok(clean.status.color === "var(--text-muted)", "json status: clean = muted");
	ok(dirty.status.color === "var(--text-warning, var(--text-muted))", "json status: errors = warning");
	ok(clean.status.fontSize === "10.5px" && clean.status.marginTop === "8px", "json status: 10.5px, 8px top");
	ok(dirty.errorLine.color === "var(--text-error, var(--text-muted))" && dirty.errorLine.paddingLeft === "6px", "json status: error line = error colour, indented");
	ok(dirty.more.color === "var(--text-muted)" && dirty.more.fontSize === "10px", "json status: more line = muted 10px");
}
