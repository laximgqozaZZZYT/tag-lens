// locateNodeFit(node, cw, ch, currentZoom, minZoom?) — "locate on canvas"
// pan-to for a navigator/menu click: keep the current zoom (floor 0.6, never
// zoom out), then pan the node's world centre to the canvas centre. Behaviour
// lock for the seam extracted from the view's `locateNodeOnCanvas`.
import { locateNodeFit } from "../src/layout/locate-fit";
import { approx, ok } from "./assert";

// Inline-equivalence with the original view code, across a grid of cases.
function expected(node: { x: number; y: number }, cw: number, ch: number, z: number) {
	const zoom = Math.max(z, 0.6);
	return { zoom, panX: cw / 2 - node.x * zoom, panY: ch / 2 - node.y * zoom };
}

for (const [x, y, cw, ch, z] of [
	[0, 0, 1000, 800, 1],
	[120, -40, 1200, 900, 0.6],
	[-300, 250, 600, 600, 2.5],
	[50, 50, 1920, 1080, 0.3],
] as const) {
	const e = expected({ x, y }, cw, ch, z);
	const f = locateNodeFit({ x, y }, cw, ch, z);
	approx(f.zoom, e.zoom, 1e-9, `zoom ${cw}x${ch} @(${x},${y}) z=${z}`);
	approx(f.panX, e.panX, 1e-9, `panX ${cw}x${ch} @(${x},${y}) z=${z}`);
	approx(f.panY, e.panY, 1e-9, `panY ${cw}x${ch} @(${x},${y}) z=${z}`);
}

// Zoom floor: a closer-than-floor current zoom snaps up to 0.6.
{
	const f = locateNodeFit({ x: 0, y: 0 }, 1000, 800, 0.1);
	approx(f.zoom, 0.6, 1e-9, "below-floor zoom snaps to 0.6");
}

// Never zoom out: a current zoom above the floor is preserved.
{
	const f = locateNodeFit({ x: 0, y: 0 }, 1000, 800, 3);
	approx(f.zoom, 3, 1e-9, "above-floor zoom preserved (no zoom-out)");
}

// Custom min floor overrides the default.
{
	const f = locateNodeFit({ x: 0, y: 0 }, 1000, 800, 0.1, 1.5);
	approx(f.zoom, 1.5, 1e-9, "custom min floor honoured");
}

// The node's world centre lands at the canvas centre.
{
	const cw = 1000;
	const ch = 800;
	const node = { x: 320, y: -140 };
	const f = locateNodeFit(node, cw, ch, 1.2);
	approx(node.x * f.zoom + f.panX, cw / 2, 1e-9, "node centre X → canvas centre");
	approx(node.y * f.zoom + f.panY, ch / 2, 1e-9, "node centre Y → canvas centre");
	ok(Number.isFinite(f.panX) && Number.isFinite(f.panY), "pans stay finite");
}
