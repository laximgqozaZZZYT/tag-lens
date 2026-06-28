// Pure geometry for the note-navigator panel (extracted from view.ts ensureNoteMenu).
// These helpers decide WHERE and HOW BIG the panel is — no DOM, no `this`, fully
// testable. The DOM application (setCssStyles) stays in view.ts as a thin wrapper.
import { clampRect, type MenuRect, type Suggestion } from "./note-menu";

// Minimum floating-panel size. Shared by the rect resolver, the drag/resize
// handlers, and the pinned-width clamp so they can never disagree.
export const NOTE_MENU_MIN = { width: 180, height: 120 } as const;

// The built-in default rect: top-left, 320px wide, ~full container height.
// Wider than the old note-only menu so the Settings form rows fit without
// horizontal scrolling.
export function defaultMenuRect(containerHeight: number): MenuRect {
	return {
		left: 8,
		top: 8,
		width: 320,
		height: Math.max(NOTE_MENU_MIN.height, (containerHeight || 600) - 16),
	};
}

// Resolve the floating panel rect (px, relative to the view root). Priority:
//   1. savedRect      — survives REBUILDS (set on every drag/resize).
//   2. settingsRect   — survives RELOADS (persisted to data.json).
//   3. the built-in default.
// Clamp to the container only when its size is known (clientHeight can be 0
// before the first paint); otherwise return the seed verbatim.
export function resolveMenuRect(
	savedRect: MenuRect | null,
	settingsRect: MenuRect | null | undefined,
	container: { width: number; height: number },
): MenuRect {
	const seed: MenuRect =
		savedRect ?? (settingsRect ? { ...settingsRect } : defaultMenuRect(container.height));
	return container.width > 0 && container.height > 0
		? clampRect(seed, container, NOTE_MENU_MIN)
		: seed;
}

// Clamp the pinned (docked) panel width: the configured width, but never below
// the minimum and never above 80% of the container.
export function clampPinnedWidth(settingsWidth: number | undefined, containerWidth: number): number {
	return Math.min(
		Math.max(NOTE_MENU_MIN.width, settingsWidth ?? 320),
		Math.max(NOTE_MENU_MIN.width, Math.floor((containerWidth || 320) * 0.8)),
	);
}

// Panel-container CSS for the note-navigator. Two looks, no DOM:
//   pinned   — docked to the right edge: full height, fixed width, square corners,
//              a left border only (like a standard docked side panel).
//   floating — a positioned box at `rect` with rounded corners + drop shadow.
// Pure builder: returns the style record the view applies via setCssStyles().
export function noteMenuPanelStyle(
	pinned: boolean,
	rect: MenuRect,
	pinnedWidth: number,
): Partial<CSSStyleDeclaration> {
	const common: Partial<CSSStyleDeclaration> = {
		position: "absolute",
		display: "flex", flexDirection: "column", overflow: "hidden",
		background: "var(--background-secondary)",
		zIndex: "60", font: "12px sans-serif", color: "var(--text-normal)",
	};
	if (pinned) {
		return {
			...common,
			left: "", right: "0", top: "0", bottom: "0", height: "", width: `${pinnedWidth}px`,
			border: "none", borderLeft: "1px solid var(--background-modifier-border)", borderRadius: "0",
			boxShadow: "-4px 0 16px rgba(0,0,0,0.5)",
		};
	}
	return {
		...common,
		left: `${rect.left}px`, top: `${rect.top}px`, right: "", bottom: "",
		width: `${rect.width}px`, height: `${rect.height}px`,
		border: "1px solid var(--background-modifier-border)", borderRadius: "6px",
		boxShadow: "0 4px 16px rgba(0,0,0,0.5)",
	};
}

// Tab-button CSS for the note-navigator's two tab strips (the top-level
// Data/Settings/Insight bar and the Data sub-tab bar). Both share the same
// underline-on-active look and differ only in padding/fontSize, so the size
// comes in as a parameter. `on` toggles the accent underline + emphasised text.
// Pure builder: returns the style record the view applies via setCssStyles().
export function noteMenuTabButtonStyle(
	on: boolean,
	size: { padding: string; fontSize: string },
): Partial<CSSStyleDeclaration> {
	return {
		background: "transparent",
		border: "none",
		borderBottom: on ? "2px solid var(--interactive-accent)" : "2px solid transparent",
		borderRadius: "0",
		padding: size.padding,
		marginBottom: "-1px",
		color: on ? "var(--text-normal)" : "var(--text-muted)",
		fontWeight: on ? "600" : "400",
		cursor: "pointer",
		fontSize: size.fontSize,
		lineHeight: "1.3",
	};
}

// Hover affordance for an inactive note-navigator tab button (both the top-level
// bar and the Data sub-bar): muted text + a faint underline hint. Applied on
// mouseenter only when the tab is NOT the active one; mouseleave restores the
// full `noteMenuTabButtonStyle`. Pure builder — applied via setCssStyles().
export function noteMenuTabHoverStyle(): Partial<CSSStyleDeclaration> {
	return {
		color: "var(--text-muted)",
		borderBottomColor: "var(--background-modifier-border)",
	};
}

// Header (title row + tab bar) CSS for the note-navigator. When floating the
// header IS the drag handle (cursor:move); when pinned the panel is docked so it
// can't be moved (cursor:default). Pure builder — applied via setCssStyles().
export function noteMenuHeadStyle(pinned: boolean): Partial<CSSStyleDeclaration> {
	return {
		padding: "6px 8px", borderBottom: "1px solid var(--background-modifier-border)", fontWeight: "600",
		cursor: pinned ? "default" : "move", userSelect: "none", flex: "0 0 auto",
	};
}

// Container CSS for the note-navigator title row. Two static layout blocks:
//   row  — the row itself: name on the left, the button group on the right
//          (space-between), vertically centred.
//   btns — the right-aligned icon-button group (pin + close), no shrink.
// Neither branches on state. Pure builder — applied via setCssStyles().
export function noteMenuTitleRowStyle(): {
	row: Partial<CSSStyleDeclaration>;
	btns: Partial<CSSStyleDeclaration>;
} {
	return {
		row: { display: "flex", alignItems: "center", justifyContent: "space-between", gap: "8px" },
		btns: { display: "flex", alignItems: "center", gap: "2px", flex: "0 0 auto" },
	};
}

// Descriptor for one title-row icon button: the style record the view applies
// via setCssStyles(), the accessible label, and (pin only) the lucide icon name.
export type NoteMenuTitleButton = {
	style: Partial<CSSStyleDeclaration>;
	ariaLabel: string;
	icon?: string;
};

// Title-row button descriptors for the note-navigator header (pin/unpin + close).
// The pin icon/colour/label flip with `pinned`; the close button is static. Pure
// builder — the view applies the styles/attrs and wires the click handlers.
export function noteMenuTitleButtons(pinned: boolean): {
	pin: NoteMenuTitleButton;
	close: NoteMenuTitleButton;
} {
	return {
		pin: {
			style: {
				cursor: "pointer",
				color: pinned ? "var(--interactive-accent)" : "var(--text-muted)",
				display: "inline-flex", alignItems: "center", padding: "0 2px",
			},
			ariaLabel: pinned ? "Unpin (float)" : "Pin to right",
			icon: pinned ? "pin-off" : "pin",
		},
		close: {
			style: {
				cursor: "pointer", fontWeight: "700", fontSize: "16px", lineHeight: "1",
				padding: "0 4px", color: "var(--text-muted)", flex: "0 0 auto",
			},
			ariaLabel: "Close menu",
		},
	};
}

// The note-navigator's two tab strips, as data. The top-level bar switches the
// whole body (Data / Settings / Insight); the Data pane's sub-bar switches the
// Data sub-view (Logic / Tree / Table / JSON). The keys double as the persisted
// `activeMenuTab` / `dataSubTab` field values, so they are the single source of
// truth for both the field types and the rendered button order/labels.
export type NoteMenuTab = "data" | "settings" | "insight";
export type NoteMenuDataSubTab = "logic" | "tree" | "table" | "json";

// Top-level tab descriptors (key + button label), in render order. Pure builder —
// the view creates one button per entry and wires the click/hover handlers.
export function noteMenuTopTabs(): { key: NoteMenuTab; label: string }[] {
	return [
		{ key: "data", label: "Data" },
		{ key: "settings", label: "Settings" },
		{ key: "insight", label: "Insight" },
	];
}

// Data sub-tab descriptors (key + button label), in render order. Pure builder —
// the view creates one button per entry and wires the click/hover handlers.
export function noteMenuDataSubTabs(): { key: NoteMenuDataSubTab; label: string }[] {
	return [
		{ key: "logic", label: "Logic" },
		{ key: "tree", label: "Tree" },
		{ key: "table", label: "Table" },
		{ key: "json", label: "JSON" },
	];
}

// Per-pane CSS `display` values for the three top-level body panes given the
// active tab. The Data wrapper is a flex-column (visible = "flex"); Settings and
// Insight are scroll panes (visible = "block"); inactive panes are "none". Pure
// builder — the view applies each value via setCssStyles().
export function noteMenuTopTabDisplay(active: NoteMenuTab): {
	data: string;
	settings: string;
	insight: string;
} {
	return {
		data: active === "data" ? "flex" : "none",
		settings: active === "settings" ? "block" : "none",
		insight: active === "insight" ? "block" : "none",
	};
}

// Per-pane CSS `display` values for the four Data sub-tab panes given the active
// sub-tab. The Tree pane is a flex-column (visible = "flex"); Logic/Table/JSON are
// block panes; inactive panes are "none". Pure builder — applied via setCssStyles().
export function noteMenuDataSubTabDisplay(active: NoteMenuDataSubTab): {
	logic: string;
	tree: string;
	table: string;
	json: string;
} {
	return {
		logic: active === "logic" ? "block" : "none",
		tree: active === "tree" ? "flex" : "none",
		table: active === "table" ? "block" : "none",
		json: active === "json" ? "block" : "none",
	};
}

// Container CSS for one of the note-navigator's two tab bars. Two shapes:
//   top — the top-level Data/Settings/Insight bar in the header: the underline
//         divider that the active tab's accent sits on (marginBottom:-1px on the
//         buttons lines them up), with a small top gap below the title row.
//   sub — the Data sub-tab bar: wraps onto multiple rows (flexWrap) and is padded
//         in from the pane edge; same bottom divider.
// Neither branches on state. Pure builder — applied via setCssStyles().
export type NoteMenuTabBarKind = "top" | "sub";

export function noteMenuTabBarStyle(kind: NoteMenuTabBarKind): Partial<CSSStyleDeclaration> {
	const divider = "1px solid var(--background-modifier-border)";
	if (kind === "top") {
		return {
			display: "flex", gap: "2px", marginTop: "8px",
			fontWeight: "400", fontSize: "11px", borderBottom: divider,
		};
	}
	return {
		display: "flex", flexWrap: "wrap", gap: "1px",
		borderBottom: divider, padding: "4px 6px 0",
	};
}

// Base container CSS for a note-navigator body panel. Two shapes:
//   scroll — a scrollable tab pane (overflow:auto + content padding).
//   column — a flex-column wrapper that nests further panes (no scroll/padding).
// Both fill the remaining panel height (flex:1 1 auto, minHeight:0). `display`
// carries the show/hide state ("none" when hidden; the pane's own block/flex when
// active). Pure builder — applied via setCssStyles().
export type NoteMenuBodyPanelKind = "scroll" | "column";

export function noteMenuBodyPanelStyle(
	kind: NoteMenuBodyPanelKind,
	display: string,
): Partial<CSSStyleDeclaration> {
	if (kind === "scroll") {
		return { display, overflow: "auto", flex: "1 1 auto", minHeight: "0", padding: "4px 6px 8px" };
	}
	return { display, flexDirection: "column", flex: "1 1 auto", minHeight: "0" };
}

// Container CSS for the Tree pane's bulk Select-all / Deselect-all row. Two static
// layout blocks:
//   bar — the row holding the two buttons (small gap, top margin).
//   btn — one bulk button: a small muted secondary-background pill.
// Neither branches on state. Pure builder — applied via setCssStyles().
export function noteMenuBulkBarStyle(): {
	bar: Partial<CSSStyleDeclaration>;
	btn: Partial<CSSStyleDeclaration>;
} {
	return {
		bar: { display: "flex", gap: "6px", marginTop: "4px" },
		btn: {
			fontSize: "10px", padding: "2px 6px", cursor: "pointer",
			background: "var(--background-secondary)", border: "1px solid var(--background-modifier-border)",
			borderRadius: "3px", color: "var(--text-muted)", lineHeight: "1.4",
		},
	};
}

// Tree-pane "group by Folder / Tag" radio bar chrome: the muted 10px-gap flex row
// and one inline-flex radio label (pointer cursor, no text selection). Both are
// static layout records (no state branch); the radio/event wiring stays in the view.
export function noteMenuGroupBarStyle(): {
	bar: Partial<CSSStyleDeclaration>;
	label: Partial<CSSStyleDeclaration>;
} {
	return {
		bar: {
			display: "flex", gap: "10px", marginTop: "4px", fontWeight: "400",
			fontSize: "11px", color: "var(--text-muted)", cursor: "default",
		},
		label: { display: "inline-flex", alignItems: "center", gap: "3px", cursor: "pointer", userSelect: "none" },
	};
}

// Tree-pane search-box chrome: the relatively-positioned wrapper, the text input,
// the absolutely-positioned autocomplete dropdown, and the scrollable tree body
// below it. Four static layout records:
//   wrap    — relative anchor for the absolute suggBox (small margins, no grow).
//   input   — the full-width search field (panel-bg, bordered).
//   suggBox — the dropdown pinned under the input (hidden by default; the view
//             flips display when there are matches).
//   body    — the tree scroll area, growing/shrinking with the panel height.
// None branch on state. Pure builder — applied via setCssStyles().
export function noteMenuSearchStyle(): {
	wrap: Partial<CSSStyleDeclaration>;
	input: Partial<CSSStyleDeclaration>;
	suggBox: Partial<CSSStyleDeclaration>;
	body: Partial<CSSStyleDeclaration>;
} {
	return {
		wrap: { position: "relative", margin: "6px 8px", flex: "0 0 auto" },
		input: {
			display: "block", width: "100%", boxSizing: "border-box", padding: "4px 6px",
			background: "var(--background-primary)", border: "1px solid var(--background-modifier-border)",
			borderRadius: "4px", color: "var(--text-normal)",
		},
		suggBox: {
			position: "absolute", left: "0", right: "0", top: "100%", marginTop: "2px",
			background: "var(--background-secondary)", border: "1px solid var(--background-modifier-border)", borderRadius: "4px",
			boxShadow: "0 4px 16px rgba(0,0,0,0.5)", zIndex: "70", overflow: "auto", maxHeight: "240px",
			display: "none",
		},
		body: { overflow: "auto", padding: "4px 6px 8px", flex: "1 1 auto", minHeight: "0" },
	};
}

// Tree-pane note-count hint shown at the top of the Result pane. The verb is
// mode-appropriate: droste focuses a card, every other mode locates/opens the
// file. Pure builder — returns the faint hint text + its static chrome; the view
// just creates the div and applies them.
export function noteMenuNotesHint(count: number, isDroste: boolean): {
	text: string;
	style: Partial<CSSStyleDeclaration>;
} {
	const verb = isDroste ? "focus" : "locate/open";
	return {
		text: `${count} notes — click to ${verb}`,
		style: { fontSize: "10px", color: "var(--text-faint)", padding: "4px 8px 0" },
	};
}

// Glyph + accent colour for an autocomplete suggestion row, keyed by its kind
// (tag / field / note). Pure presentation map — the suggestion dropdown in
// ensureNoteMenu reads this for the leading glyph span; centralises what used to
// be two inline `Record<Suggestion["kind"], …>` literals so the glyph↔colour↔kind
// mapping has a single source of truth.
export function suggestionKindStyle(kind: Suggestion["kind"]): { glyph: string; color: string } {
	switch (kind) {
		case "tag":
			return { glyph: "#", color: "var(--text-accent)" };
		case "field":
			return { glyph: "⊳", color: "var(--color-purple)" };
		default:
			return { glyph: "·", color: "var(--text-muted)" };
	}
}
