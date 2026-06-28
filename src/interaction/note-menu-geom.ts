// Pure geometry for the note-navigator panel (extracted from view.ts ensureNoteMenu).
// These helpers decide WHERE and HOW BIG the panel is — no DOM, no `this`, fully
// testable. The DOM application (setCssStyles) stays in view.ts as a thin wrapper.
import { clampRect, type MenuRect } from "./note-menu";

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
