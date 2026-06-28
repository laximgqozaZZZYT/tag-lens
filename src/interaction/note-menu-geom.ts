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
