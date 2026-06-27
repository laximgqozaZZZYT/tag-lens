// Shared headless Canvas 2D context stand-in for the render SMOKE tests.
//
// It COUNTS the draw ops the smoke tests assert on (fillRect / strokeRect /
// fillText / strokeText / fill / stroke) and NO-OPS everything else the draw
// code touches (paths, transforms, gradients, dashes, images). `measureText`
// returns a deterministic width so text layout is reproducible without a DOM.
//
// Extracted from bubblesets-render-smoke.test.ts so every per-mode smoke test
// shares one mock and the value of "an unstubbed canvas method throws" (the
// `undefined is not a function` signal these tests are designed to catch) is
// preserved uniformly across modes.

export interface Rec {
	fillRect: number;
	strokeRect: number;
	fillText: number;
	strokeText: number;
	fill: number;
	stroke: number;
}

export function recordingCtx(): { ctx: CanvasRenderingContext2D; rec: Rec } {
	const rec: Rec = { fillRect: 0, strokeRect: 0, fillText: 0, strokeText: 0, fill: 0, stroke: 0 };
	const grad = { addColorStop() {} };
	const c = {
		fillStyle: "" as unknown, strokeStyle: "" as unknown, lineWidth: 1, font: "",
		textAlign: "start", textBaseline: "alphabetic", globalAlpha: 1, lineJoin: "miter",
		lineCap: "butt", miterLimit: 10, shadowBlur: 0, shadowColor: "", shadowOffsetX: 0, shadowOffsetY: 0,
		save() {}, restore() {}, beginPath() {}, closePath() {}, moveTo() {}, lineTo() {},
		arc() {}, arcTo() {}, ellipse() {}, rect() {}, roundRect() {}, clip() {},
		quadraticCurveTo() {}, bezierCurveTo() {}, translate() {}, scale() {}, rotate() {},
		setTransform() {}, resetTransform() {}, transform() {}, setLineDash() {}, getLineDash() { return [] as number[]; },
		createLinearGradient() { return grad; }, createRadialGradient() { return grad; }, createPattern() { return null; },
		drawImage() {}, clearRect() {},
		fill() { rec.fill++; }, stroke() { rec.stroke++; },
		fillRect() { rec.fillRect++; }, strokeRect() { rec.strokeRect++; },
		fillText() { rec.fillText++; }, strokeText() { rec.strokeText++; },
		measureText(t: string) {
			return { width: (t ? t.length : 0) * 6, actualBoundingBoxAscent: 7, actualBoundingBoxDescent: 2 } as TextMetrics;
		},
	};
	return { ctx: c as unknown as CanvasRenderingContext2D, rec };
}

// True when the recorder saw ANY drawing op (a figure was actually painted).
export function drewSomething(rec: Rec): boolean {
	return rec.fill + rec.stroke + rec.fillRect + rec.strokeRect + rec.fillText + rec.strokeText > 0;
}

// A minimal HTMLCanvasElement stand-in that the mode renderers read
// width/height/clientWidth/clientHeight off (and getContext() for the few that
// re-fetch their own ctx). dpr is folded into width/height by the caller the
// same way the live view does (canvas.width = clientWidth * dpr).
export function mockCanvas(clientWidth: number, clientHeight: number, dpr = 1, ctx?: CanvasRenderingContext2D): HTMLCanvasElement {
	const cv = {
		width: Math.round(clientWidth * dpr),
		height: Math.round(clientHeight * dpr),
		clientWidth,
		clientHeight,
		getContext: () => ctx ?? null,
	};
	// Wire the ctx→canvas back-reference the live Canvas 2D API guarantees
	// (some renderers read ctx.canvas.width instead of the passed-in canvas).
	if (ctx) (ctx as unknown as { canvas: unknown }).canvas = cv;
	return cv as unknown as HTMLCanvasElement;
}
