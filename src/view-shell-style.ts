// Pure chrome for the view shell (extracted from view.ts onOpen).
// These return the static base styles for the view root container and its
// canvas child — no DOM, no `this`, fully testable. The DOM application
// (setCssStyles) stays in view.ts as a thin wrapper. Mirrors the
// note-menu-geom style-builder pattern.

// The view root: no padding, clip overflow, and act as the positioning
// context for the absolutely-placed note-menu panel / overlays.
export function viewRootStyle(): Partial<CSSStyleDeclaration> {
	return { padding: "0", overflow: "hidden", position: "relative" };
}

// The canvas fills the root and shows the grab cursor for panning. `display:
// block` removes the inline-element baseline gap.
export function viewCanvasStyle(): Partial<CSSStyleDeclaration> {
	return { width: "100%", height: "100%", display: "block", cursor: "grab" };
}
