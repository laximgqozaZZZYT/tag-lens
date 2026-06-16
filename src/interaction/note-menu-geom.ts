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
