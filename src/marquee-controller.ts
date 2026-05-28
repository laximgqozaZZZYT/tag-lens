// Marquee selection state machine. The user can either:
//   (a) shift-drag, which immediately starts a marquee, or
//   (b) press the toolbar marquee button (= "arm" the mode), then
//       drag, which also starts a marquee.
// Releasing the drag computes the world-space rectangle and asks the
// host to `fitToView` it (= zoom to selection).
//
// State machine kept entirely inside this controller; the view only
// pumps pointer events and queries `isActive()` / `isArmed()` for
// decisions like "should the next mousedown start a pan or marquee?".
export interface MarqueeDeps {
	canvas: HTMLCanvasElement;
	root: HTMLElement;
	screenToWorld(sx: number, sy: number): { x: number; y: number };
	fitToRect(world: {
		minX: number;
		minY: number;
		maxX: number;
		maxY: number;
	}): void;
	// Called when a marquee starts or arms, so the host can hide any
	// hover tooltip / suppress hover work.
	onActivate(): void;
}

const MIN_MARQUEE_SIDE_PX = 6;

export class MarqueeController {
	private armed = false;
	private startPt: { sx: number; sy: number } | null = null;
	private el: HTMLDivElement | null = null;

	constructor(private deps: MarqueeDeps) {}

	isArmed(): boolean {
		return this.armed;
	}

	isActive(): boolean {
		return this.startPt !== null;
	}

	// Arm the mode without starting a drag yet. Cursor becomes a
	// crosshair so the user gets visual feedback that the next drag
	// will marquee-select.
	arm(): void {
		this.armed = true;
		this.deps.canvas.style.cursor = "crosshair";
		this.deps.onActivate();
	}

	// Begin a drag at (sx, sy) in canvas-relative pixels. Creates the
	// overlay div that grows with the cursor in `update()`.
	begin(sx: number, sy: number): void {
		this.deps.onActivate();
		this.startPt = { sx, sy };
		const el = document.createElement("div");
		el.className = "gim-marquee";
		el.style.left = sx + "px";
		el.style.top = sy + "px";
		el.style.width = "0px";
		el.style.height = "0px";
		this.deps.root.appendChild(el);
		this.el = el;
	}

	// Resize the overlay div to span (startPt, cursor). Clamped to the
	// canvas rect so a drag that exits the canvas doesn't paint outside.
	update(clientX: number, clientY: number): void {
		if (!this.startPt || !this.el) return;
		const rect = this.deps.canvas.getBoundingClientRect();
		const sx = Math.max(0, Math.min(rect.width, clientX - rect.left));
		const sy = Math.max(0, Math.min(rect.height, clientY - rect.top));
		const x = Math.min(this.startPt.sx, sx);
		const y = Math.min(this.startPt.sy, sy);
		const w = Math.abs(sx - this.startPt.sx);
		const h = Math.abs(sy - this.startPt.sy);
		this.el.style.left = x + "px";
		this.el.style.top = y + "px";
		this.el.style.width = w + "px";
		this.el.style.height = h + "px";
	}

	// End the drag. Computes the world-space rect and calls fitToRect
	// unless the rect is tiny (< MIN_MARQUEE_SIDE_PX on either axis,
	// = essentially a click).
	finish(clientX: number, clientY: number): void {
		if (!this.startPt) return;
		const rect = this.deps.canvas.getBoundingClientRect();
		const sx = clientX - rect.left;
		const sy = clientY - rect.top;
		const x0 = Math.min(this.startPt.sx, sx);
		const y0 = Math.min(this.startPt.sy, sy);
		const x1 = Math.max(this.startPt.sx, sx);
		const y1 = Math.max(this.startPt.sy, sy);
		this.cancel();
		if (x1 - x0 < MIN_MARQUEE_SIDE_PX || y1 - y0 < MIN_MARQUEE_SIDE_PX)
			return;
		const a = this.deps.screenToWorld(x0, y0);
		const b = this.deps.screenToWorld(x1, y1);
		this.deps.fitToRect({ minX: a.x, minY: a.y, maxX: b.x, maxY: b.y });
	}

	// Reset to neutral. Used both on finish (after fitToRect) and on
	// Esc / drag-out-of-canvas.
	cancel(): void {
		this.startPt = null;
		this.armed = false;
		this.deps.canvas.style.cursor = "grab";
		if (this.el) {
			this.el.remove();
			this.el = null;
		}
	}
}
