// F3 — pure Canvas2D→SVG recorder. Reuses the existing draw() pipeline: swap the
// view's `ctx` for an instance of this, call draw(), then read toSvg(). It
// implements exactly the CanvasRenderingContext2D subset that src/draw/* uses
// (verified: no drawImage / gradients / patterns / ImageData — the figures are
// pure vector primitives + text). measureText is delegated to an injected
// measurer so this file stays DOM-free and unit-testable in Node.
//
// Design notes:
// - canvas setTransform() is ABSOLUTE (SVG nested <g transform> are relative), so
//   we keep our own CTM and BAKE every coordinate into absolute user space.
// - clip() is realised as a wrapping <g clip-path="…"> opened at the clip site
//   and closed by the restore() that unwinds past the enclosing save() — this
//   clips in absolute space (matching canvas device space) regardless of any
//   per-element transform (e.g. rotated axis labels inside a clipped pane).
// - stroke widths, dashes and (for non-text) sizes are scaled by the uniform CTM
//   factor; text is emitted with its own transform attribute so its font-size
//   stays in local units.

export type Matrix = [number, number, number, number, number, number]; // a,b,c,d,e,f

export interface TextMetricsLike {
	width: number;
}

interface RecState {
	m: Matrix;
	fillStyle: string;
	strokeStyle: string;
	lineWidth: number;
	font: string;
	textAlign: CanvasTextAlign;
	textBaseline: CanvasTextBaseline;
	globalAlpha: number;
	lineDash: number[];
	lineJoin: string;
	lineCap: string;
	// Depth in `groups` at the moment of save(); restore() closes any groups
	// opened (by clip()) above this depth.
	groupDepth: number;
}

interface OpenGroup {
	openTag: string;
	children: string[];
}

const IDENTITY: Matrix = [1, 0, 0, 1, 0, 0];

function mul(a: Matrix, b: Matrix): Matrix {
	// a ∘ b  (apply b then a), matching DOMMatrix.multiply semantics used by canvas.
	return [
		a[0] * b[0] + a[2] * b[1],
		a[1] * b[0] + a[3] * b[1],
		a[0] * b[2] + a[2] * b[3],
		a[1] * b[2] + a[3] * b[3],
		a[0] * b[4] + a[2] * b[5] + a[4],
		a[1] * b[4] + a[3] * b[5] + a[5],
	];
}

function num(n: number): string {
	// Compact, deterministic numbers — round to 3 dp and strip trailing zeros.
	if (!isFinite(n)) return "0";
	const r = Math.round(n * 1000) / 1000;
	return Object.is(r, -0) ? "0" : String(r);
}

function esc(s: string): string {
	return s
		.replace(/&/g, "&amp;")
		.replace(/</g, "&lt;")
		.replace(/>/g, "&gt;")
		.replace(/"/g, "&quot;");
}

// "700 13px sans-serif" → { weight, style, size, family }. Tolerant: anything it
// can't classify becomes part of the family so the <text> still renders.
function parseFont(font: string): { weight: string; style: string; size: number; family: string } {
	let weight = "normal";
	let style = "normal";
	let size = 12;
	const parts = font.trim().split(/\s+/);
	const family: string[] = [];
	let sawSize = false;
	for (const p of parts) {
		if (!sawSize && /^(normal|italic|oblique)$/.test(p)) { style = p; continue; }
		if (!sawSize && /^(normal|bold|bolder|lighter|\d{3})$/.test(p)) { weight = p; continue; }
		const m = /^(\d*\.?\d+)px$/.exec(p);
		if (!sawSize && m) { size = parseFloat(m[1]); sawSize = true; continue; }
		family.push(p);
	}
	return { weight, style, size, family: family.join(" ") || "sans-serif" };
}

export class SvgRecorderContext {
	// Public canvas stand-in so draw() can read ctx.canvas.{width,height}.
	canvas: { width: number; height: number };

	private measure: (text: string, font: string) => number;
	private s: RecState;
	private stack: RecState[] = [];
	private defs: string[] = [];
	private root: string[] = [];
	private groups: OpenGroup[] = [];
	private clipSeq = 0;
	private pathSubs: string[] = []; // baked SVG path data fragments (current path)

	constructor(width: number, height: number, measure: (text: string, font: string) => number) {
		this.canvas = { width, height };
		this.measure = measure;
		this.s = {
			m: [...IDENTITY] as Matrix,
			fillStyle: "#000000",
			strokeStyle: "#000000",
			lineWidth: 1,
			font: "10px sans-serif",
			textAlign: "start",
			textBaseline: "alphabetic",
			globalAlpha: 1,
			lineDash: [],
			lineJoin: "miter",
			lineCap: "butt",
			groupDepth: 0,
		};
	}

	// ── style accessors (plain fields are enough for our subset) ──────────────
	get fillStyle(): string { return this.s.fillStyle; }
	set fillStyle(v: string) { this.s.fillStyle = String(v); }
	get strokeStyle(): string { return this.s.strokeStyle; }
	set strokeStyle(v: string) { this.s.strokeStyle = String(v); }
	get lineWidth(): number { return this.s.lineWidth; }
	set lineWidth(v: number) { this.s.lineWidth = v; }
	get font(): string { return this.s.font; }
	set font(v: string) { this.s.font = String(v); }
	get textAlign(): CanvasTextAlign { return this.s.textAlign; }
	set textAlign(v: CanvasTextAlign) { this.s.textAlign = v; }
	get textBaseline(): CanvasTextBaseline { return this.s.textBaseline; }
	set textBaseline(v: CanvasTextBaseline) { this.s.textBaseline = v; }
	get globalAlpha(): number { return this.s.globalAlpha; }
	set globalAlpha(v: number) { this.s.globalAlpha = v; }
	get lineJoin(): string { return this.s.lineJoin; }
	set lineJoin(v: string) { this.s.lineJoin = v; }
	get lineCap(): string { return this.s.lineCap; }
	set lineCap(v: string) { this.s.lineCap = v; }

	setLineDash(d: number[]): void { this.s.lineDash = Array.isArray(d) ? d.slice() : []; }
	getLineDash(): number[] { return this.s.lineDash.slice(); }

	// ── transforms ────────────────────────────────────────────────────────────
	save(): void {
		this.stack.push({ ...this.s, m: [...this.s.m] as Matrix, lineDash: this.s.lineDash.slice(), groupDepth: this.groups.length });
	}
	restore(): void {
		const prev = this.stack.pop();
		if (!prev) return;
		// Close any clip groups opened since the matching save().
		while (this.groups.length > prev.groupDepth) this.closeGroup();
		this.s = prev;
	}
	setTransform(a: number, b: number, c: number, d: number, e: number, f: number): void {
		this.s.m = [a, b, c, d, e, f];
	}
	translate(x: number, y: number): void {
		this.s.m = mul(this.s.m, [1, 0, 0, 1, x, y]);
	}
	rotate(rad: number): void {
		const cos = Math.cos(rad), sin = Math.sin(rad);
		this.s.m = mul(this.s.m, [cos, sin, -sin, cos, 0, 0]);
	}

	// ── path building (bake to absolute at add-time, like canvas) ─────────────
	beginPath(): void { this.pathSubs = []; }
	closePath(): void { this.pathSubs.push("Z"); }
	private pt(x: number, y: number): [number, number] {
		const m = this.s.m;
		return [m[0] * x + m[2] * y + m[4], m[1] * x + m[3] * y + m[5]];
	}
	private scaleFactor(): number {
		const m = this.s.m;
		return Math.hypot(m[0], m[1]) || 1;
	}
	moveTo(x: number, y: number): void { const [X, Y] = this.pt(x, y); this.pathSubs.push(`M${num(X)} ${num(Y)}`); }
	lineTo(x: number, y: number): void { const [X, Y] = this.pt(x, y); this.pathSubs.push(`L${num(X)} ${num(Y)}`); }
	quadraticCurveTo(cx: number, cy: number, x: number, y: number): void {
		const [CX, CY] = this.pt(cx, cy); const [X, Y] = this.pt(x, y);
		this.pathSubs.push(`Q${num(CX)} ${num(CY)} ${num(X)} ${num(Y)}`);
	}
	bezierCurveTo(c1x: number, c1y: number, c2x: number, c2y: number, x: number, y: number): void {
		const [A, B] = this.pt(c1x, c1y); const [C, D] = this.pt(c2x, c2y); const [X, Y] = this.pt(x, y);
		this.pathSubs.push(`C${num(A)} ${num(B)} ${num(C)} ${num(D)} ${num(X)} ${num(Y)}`);
	}
	rect(x: number, y: number, w: number, h: number): void {
		const p0 = this.pt(x, y), p1 = this.pt(x + w, y), p2 = this.pt(x + w, y + h), p3 = this.pt(x, y + h);
		this.pathSubs.push(
			`M${num(p0[0])} ${num(p0[1])}L${num(p1[0])} ${num(p1[1])}L${num(p2[0])} ${num(p2[1])}L${num(p3[0])} ${num(p3[1])}Z`,
		);
	}
	arc(x: number, y: number, r: number, start: number, end: number, ccw = false): void {
		// Bake centre + radius. Emit SVG arc(s); full circles become two semicircles.
		const s = this.scaleFactor();
		const rr = r * s;
		const c = this.pt(x, y);
		const full = Math.abs(end - start) >= Math.PI * 2 - 1e-6;
		const a0 = start;
		const a1 = full ? start + Math.PI * 2 * (ccw ? -1 : 1) : end;
		const sweep = ccw ? 0 : 1;
		const px = (ang: number): [number, number] => [c[0] + rr * Math.cos(ang), c[1] + rr * Math.sin(ang)];
		if (full) {
			const p0 = px(a0), pmid = px(a0 + Math.PI * (ccw ? -1 : 1)), pend = px(a1);
			this.pathSubs.push(
				`M${num(p0[0])} ${num(p0[1])}A${num(rr)} ${num(rr)} 0 1 ${sweep} ${num(pmid[0])} ${num(pmid[1])}` +
				`A${num(rr)} ${num(rr)} 0 1 ${sweep} ${num(pend[0])} ${num(pend[1])}`,
			);
		} else {
			const p0 = px(a0), pend = px(a1);
			const large = Math.abs(a1 - a0) > Math.PI ? 1 : 0;
			this.pathSubs.push(`M${num(p0[0])} ${num(p0[1])}A${num(rr)} ${num(rr)} 0 ${large} ${sweep} ${num(pend[0])} ${num(pend[1])}`);
		}
	}

	// ── fills / strokes / clip ────────────────────────────────────────────────
	private out(el: string): void {
		(this.groups.length ? this.groups[this.groups.length - 1].children : this.root).push(el);
	}
	private alphaAttr(): string {
		return this.s.globalAlpha < 1 ? ` opacity="${num(this.s.globalAlpha)}"` : "";
	}
	private strokeAttrs(): string {
		const s = this.scaleFactor();
		let a = ` stroke="${esc(this.s.strokeStyle)}" stroke-width="${num(this.s.lineWidth * s)}" fill="none"`;
		if (this.s.lineJoin !== "miter") a += ` stroke-linejoin="${this.s.lineJoin}"`;
		if (this.s.lineCap !== "butt") a += ` stroke-linecap="${this.s.lineCap}"`;
		if (this.s.lineDash.length) a += ` stroke-dasharray="${this.s.lineDash.map((d) => num(d * s)).join(",")}"`;
		return a;
	}
	private d(): string { return this.pathSubs.join(""); }

	fill(): void {
		if (!this.pathSubs.length) return;
		this.out(`<path d="${this.d()}" fill="${esc(this.s.fillStyle)}"${this.alphaAttr()}/>`);
	}
	stroke(): void {
		if (!this.pathSubs.length) return;
		this.out(`<path d="${this.d()}"${this.strokeAttrs()}${this.alphaAttr()}/>`);
	}
	fillRect(x: number, y: number, w: number, h: number): void {
		const p0 = this.pt(x, y), p1 = this.pt(x + w, y), p2 = this.pt(x + w, y + h), p3 = this.pt(x, y + h);
		const d = `M${num(p0[0])} ${num(p0[1])}L${num(p1[0])} ${num(p1[1])}L${num(p2[0])} ${num(p2[1])}L${num(p3[0])} ${num(p3[1])}Z`;
		this.out(`<path d="${d}" fill="${esc(this.s.fillStyle)}"${this.alphaAttr()}/>`);
	}
	strokeRect(x: number, y: number, w: number, h: number): void {
		const p0 = this.pt(x, y), p1 = this.pt(x + w, y), p2 = this.pt(x + w, y + h), p3 = this.pt(x, y + h);
		const d = `M${num(p0[0])} ${num(p0[1])}L${num(p1[0])} ${num(p1[1])}L${num(p2[0])} ${num(p2[1])}L${num(p3[0])} ${num(p3[1])}Z`;
		this.out(`<path d="${d}"${this.strokeAttrs()}${this.alphaAttr()}/>`);
	}
	clip(): void {
		if (!this.pathSubs.length) return;
		const id = `tlc${++this.clipSeq}`;
		this.defs.push(`<clipPath id="${id}"><path d="${this.d()}"/></clipPath>`);
		this.openGroup(`<g clip-path="url(#${id})">`);
	}

	private openGroup(openTag: string): void {
		this.groups.push({ openTag, children: [] });
	}
	private closeGroup(): void {
		const g = this.groups.pop();
		if (!g) return;
		const serialized = g.openTag + g.children.join("") + "</g>";
		this.out(serialized);
	}

	// ── text ──────────────────────────────────────────────────────────────────
	measureText(text: string): TextMetricsLike {
		return { width: this.measure(text, this.s.font) };
	}
	fillText(text: string, x: number, y: number): void { this.emitText(text, x, y, this.s.fillStyle, null); }
	strokeText(text: string, x: number, y: number): void { this.emitText(text, x, y, "none", this.s.strokeStyle); }

	private emitText(text: string, x: number, y: number, fill: string, stroke: string | null): void {
		if (text === "" || text == null) return;
		const f = parseFont(this.s.font);
		const anchor = this.s.textAlign === "center" ? "middle" : this.s.textAlign === "right" || this.s.textAlign === "end" ? "end" : "start";
		const baseline =
			this.s.textBaseline === "top" ? "text-before-edge" :
			this.s.textBaseline === "middle" ? "central" :
			this.s.textBaseline === "bottom" ? "text-after-edge" :
			this.s.textBaseline === "hanging" ? "hanging" : "alphabetic";
		const m = this.s.m;
		const tf = `matrix(${num(m[0])},${num(m[1])},${num(m[2])},${num(m[3])},${num(m[4])},${num(m[5])})`;
		let attrs = `x="${num(x)}" y="${num(y)}" font-family="${esc(f.family)}" font-size="${num(f.size)}"`;
		if (f.weight !== "normal") attrs += ` font-weight="${f.weight}"`;
		if (f.style !== "normal") attrs += ` font-style="${f.style}"`;
		attrs += ` text-anchor="${anchor}" dominant-baseline="${baseline}" fill="${esc(fill)}"`;
		if (stroke) attrs += ` stroke="${esc(stroke)}" stroke-width="${num(this.s.lineWidth * this.scaleFactor())}"`;
		attrs += ` transform="${tf}"${this.alphaAttr()}`;
		this.out(`<text ${attrs}>${esc(text)}</text>`);
	}

	// ── output ──────────────────────────────────────────────────────────────
	toSvg(): string {
		// Close any clip groups left open (defensive — draw() balances save/restore).
		while (this.groups.length) this.closeGroup();
		const w = this.canvas.width, h = this.canvas.height;
		const defs = this.defs.length ? `<defs>${this.defs.join("")}</defs>` : "";
		return (
			`<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}" viewBox="0 0 ${w} ${h}">` +
			defs + this.root.join("") + `</svg>`
		);
	}
}
