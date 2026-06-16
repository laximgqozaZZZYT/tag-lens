// Pure pan/zoom transform math (extracted from view.ts). No DOM, no `this`.
// A Transform is the canvas world↔screen mapping: screen = world * zoom + pan.
// The view holds zoom/panX/panY as separate fields; these helpers compute the
// next transform and the view assigns the result (the side effects — cancelHover,
// requestDraw — stay in the view as a thin wrapper).
export interface Transform {
	zoom: number;
	panX: number;
	panY: number;
}

// Global zoom clamp, shared by every zoom path (wheel, buttons, fit).
export const ZOOM_MIN = 0.005;
export const ZOOM_MAX = 8;

// Zoom by `factor` while keeping the screen point (sx, sy) anchored to the same
// world coordinate — i.e. the pixel under the cursor doesn't move. Used by the
// wheel handler and the zoom-in/out buttons (which anchor on the canvas centre).
export function zoomAroundPointer(t: Transform, factor: number, sx: number, sy: number): Transform {
	const next = Math.max(ZOOM_MIN, Math.min(ZOOM_MAX, t.zoom * factor));
	const wx = (sx - t.panX) / t.zoom;
	const wy = (sy - t.panY) / t.zoom;
	return { zoom: next, panX: sx - wx * next, panY: sy - wy * next };
}

// Fit a world rectangle into a canvas with `pad` px of uniform margin, centring
// the rect. The zoom is the largest that keeps the rect inside (clamped to the
// global range); pan then centres the rect's midpoint in the canvas. Used by
// fitToRect (the symmetric-padding fit); fitToView keeps its own asymmetric math.
export function fitTransform(
	world: { minX: number; minY: number; maxX: number; maxY: number },
	canvasW: number,
	canvasH: number,
	pad: number,
): Transform {
	const dw = Math.max(1, world.maxX - world.minX);
	const dh = Math.max(1, world.maxY - world.minY);
	const z = Math.min((canvasW - 2 * pad) / dw, (canvasH - 2 * pad) / dh);
	const zoom = Math.min(ZOOM_MAX, Math.max(ZOOM_MIN, z));
	return {
		zoom,
		panX: canvasW / 2 - ((world.minX + world.maxX) / 2) * zoom,
		panY: canvasH / 2 - ((world.minY + world.maxY) / 2) * zoom,
	};
}
