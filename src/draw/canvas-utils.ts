// Canvas drawing helpers and small string utilities used by the renderer.
import { theme } from "./theme";

// Which set-operation a striped node depicts, and therefore its stripe
// ORIENTATION. The renderer maps:
//   • intersection (∩) → VERTICAL bars  (a node sitting in the OVERLAP of ≥2
//     clusters — the well-defined per-node intersection case)
//   • union (∪)        → HORIZONTAL bars (a node that stands for the WHOLE of
//     one-or-more sets, i.e. a tag-core / set node that is the union of its
//     members)
// This keeps the node fills consistent with the closeup legend, where ∪ layers
// already draw horizontal and ∩ layers vertical.
export type SetKind = "intersection" | "union";

export interface NodeStripe {
	hues: number[];
	isVertical: boolean; // true → ∩ vertical · false → ∪ horizontal
}

// Decide a SET node's stripe ORIENTATION + hue list purely from its
// memberships and whether it is a set-core (union) or an overlap node
// (intersection). Pure + DOM-free so the orientation/colour decision is
// unit-testable independently of the CanvasPattern rasterisation.
//
//   • set-core node (isUnionCore) → UNION  → horizontal (isVertical=false)
//   • multi-membership node       → INTERSECTION → vertical (isVertical=true)
//
// The hue list is the node's distinct cluster hues. Callers feed the result
// straight into createStripePattern(hues, isVertical); a single hue collapses
// to a solid fill there (no visible stripe), so a plain single-tag node is
// untouched.
export function resolveNodeStripe(
	memberships: string[],
	isUnionCore: boolean,
): NodeStripe {
	const hues = memberships.map((m) => clusterHue(m));
	return { hues, isVertical: !isUnionCore };
}

// Excel-style column header letters: 0 → "A", 25 → "Z", 26 → "AA",
// 27 → "AB", ...
export function colLetters(c: number): string {
	if (c < 0) return "";
	let n = c + 1;
	let s = "";
	while (n > 0) {
		const rem = (n - 1) % 26;
		s = String.fromCharCode(65 + rem) + s;
		n = Math.floor((n - 1) / 26);
	}
	return s;
}

// Stable hue (0-359) derived from a cluster's groupKey. Uses a tiny
// string hash multiplied by the golden-angle constant so neighbouring
// clusters end up far apart on the colour wheel even when their keys are
// similar.
export function clusterHue(key: string): number {
	let h = 2166136261;
	for (let i = 0; i < key.length; i++) {
		h ^= key.charCodeAt(i);
		h = Math.imul(h, 16777619);
	}
	const u = (h >>> 0) / 0xffffffff;
	return (u * 360 * 1.61803398875) % 360;
}

export function roundedRectPath(
	ctx: CanvasRenderingContext2D,
	x: number,
	y: number,
	w: number,
	h: number,
	r: number,
): void {
	const rr = Math.max(0, Math.min(r, w / 2, h / 2));
	ctx.moveTo(x + rr, y);
	ctx.lineTo(x + w - rr, y);
	ctx.quadraticCurveTo(x + w, y, x + w, y + rr);
	ctx.lineTo(x + w, y + h - rr);
	ctx.quadraticCurveTo(x + w, y + h, x + w - rr, y + h);
	ctx.lineTo(x + rr, y + h);
	ctx.quadraticCurveTo(x, y + h, x, y + h - rr);
	ctx.lineTo(x, y + rr);
	ctx.quadraticCurveTo(x, y, x + rr, y);
}

// Word-aware wrapping with character-break fallback for over-long tokens
// (covers Japanese where there are no whitespace separators).
export function wrapText(
	ctx: CanvasRenderingContext2D,
	text: string,
	maxWidth: number,
	maxLines: number = 8,
): string[] {
	if (maxWidth <= 0 || maxLines <= 0) return [];
	const lines: string[] = [];
	const paragraphs = text.split(/\n+/);
	outer: for (const para of paragraphs) {
		const tokens = para.match(/\S+|\s+/g) ?? [];
		let cur = "";
		for (const tok of tokens) {
			const candidate = cur + tok;
			if (ctx.measureText(candidate).width <= maxWidth) {
				cur = candidate;
				continue;
			}
			if (cur.trim()) {
				lines.push(cur.trimEnd());
				if (lines.length >= maxLines) break outer;
			}
			if (ctx.measureText(tok).width > maxWidth) {
				let chunk = "";
				for (const ch of tok) {
					const t = chunk + ch;
					if (ctx.measureText(t).width <= maxWidth) {
						chunk = t;
					} else {
						if (chunk) lines.push(chunk);
						if (lines.length >= maxLines) break outer;
						chunk = ch;
					}
				}
				cur = chunk;
			} else {
				cur = tok.trimStart();
			}
		}
		if (cur.trim() && lines.length < maxLines) lines.push(cur.trimEnd());
		if (lines.length >= maxLines) break;
	}
	if (lines.length > maxLines) lines.length = maxLines;
	// Add ellipsis on last line if text exceeded our line budget.
	if (lines.length === maxLines) {
		const last = lines[maxLines - 1];
		const withEll = last.replace(/\s+$/, "") + "…";
		if (ctx.measureText(withEll).width <= maxWidth) {
			lines[maxLines - 1] = withEll;
		} else {
			lines[maxLines - 1] = truncateToWidth(ctx, last, maxWidth);
		}
	}
	return lines;
}

export function truncateToWidth(
	ctx: CanvasRenderingContext2D,
	text: string,
	maxWidth: number,
): string {
	if (ctx.measureText(text).width <= maxWidth) return text;
	const ell = "…";
	let lo = 0,
		hi = text.length;
	while (lo < hi) {
		const mid = (lo + hi + 1) >> 1;
		if (ctx.measureText(text.slice(0, mid) + ell).width <= maxWidth) lo = mid;
		else hi = mid - 1;
	}
	return lo === 0 ? ell : text.slice(0, lo) + ell;
}

// === Font-floor helpers ============================================
// Single source of truth for the user-configured minimum font size
// (settings.minFontPx). Two flavours because text is rendered in two
// coordinate systems:
//   - WORLD-space text (e.g. card titles) scales with `zoom`; we need
//     to bump its world value so the rendered SCREEN size never drops
//     below the floor.
//   - SCREEN-fixed text (e.g. cluster labels drawn after a transform
//     reset) is already in screen px; just `Math.max`.

export function floorWorldFontPx(
	intendedWorldPx: number,
	minScreenPx: number,
	zoom: number,
): number {
	if (zoom <= 0) return intendedWorldPx;
	return Math.max(intendedWorldPx, minScreenPx / zoom);
}

export function floorScreenFontPx(
	intendedScreenPx: number,
	minScreenPx: number,
): number {
	return Math.max(intendedScreenPx, minScreenPx);
}

// Build a repeating stripe pattern from a list of cluster hues so a node /
// legend swatch that belongs to MULTIPLE sets reads as a striped blend rather
// than a single averaged hue. `isVertical` chooses the stripe orientation —
// the renderer maps intersection (∩) → vertical bars, union (∪) → horizontal.
//
// Degenerate cases collapse to a flat colour string:
//   • no hues   → "gray"
//   • one hue   → that hue's solid fill swatch
//   • non-DOM   → first hue's swatch (tests run in plain Node with no
//                 `document`; the SSR/test path must never throw).
// A `CanvasPattern` is only returned when a real 2D context is available.
export function createStripePattern(
	hues: number[],
	isVertical: boolean,
	alpha?: number,
): CanvasPattern | string {
	if (hues.length === 0) return "gray";
	const fallback = (): string => theme().swatch(hues[0], "fill", alpha);
	if (hues.length === 1) return fallback();
	// No DOM (unit-test/SSR) → flat fallback so callers never crash.
	if (typeof document === "undefined") return fallback();

	const canvas = document.createElement("canvas");
	canvas.width = 16;
	canvas.height = 16;
	const ctx = canvas.getContext("2d");
	if (!ctx) return fallback();

	const w = canvas.width;
	const h = canvas.height;
	if (isVertical) {
		const stripeW = w / hues.length;
		for (let i = 0; i < hues.length; i++) {
			ctx.fillStyle = theme().swatch(hues[i], "fill", alpha);
			ctx.fillRect(i * stripeW, 0, stripeW, h);
		}
	} else {
		const stripeH = h / hues.length;
		for (let i = 0; i < hues.length; i++) {
			ctx.fillStyle = theme().swatch(hues[i], "fill", alpha);
			ctx.fillRect(0, i * stripeH, w, stripeH);
		}
	}
	return ctx.createPattern(canvas, "repeat") ?? fallback();
}

// === ONE-CYCLE stripe gradient ==========================================
// A `createStripePattern` builds a SMALL repeating tile, so a large fill
// shows the stripe set many times over. For a GROUP ENCLOSURE (or any node
// whose bounding box is known) the user wants the parent-set colours to read
// as ONE equal-width pass across the whole shape — exactly like the nodes —
// instead of a fine repeat. `createStripeGradient` paints that single cycle:
// each of N hues occupies an equal `[i/N, (i+1)/N]` band of the box, with
// HARD stops at every boundary so the bands stay crisp (no blended gradient).
//
//   • isVertical = true  → ∩ intersection → bands run LEFT→RIGHT (vertical
//     stripes), gradient laid out along X (x → x+w).
//   • isVertical = false → ∪ union        → bands run TOP→BOTTOM (horizontal
//     stripes), gradient laid out along Y (y → y+h).
//
// Orientation matches createStripePattern / resolveNodeStripe and the closeup
// legend so nodes, enclosures, and legend all agree.

// Pure stop-list builder: for N colours return the ordered colour-stop pairs
// {offset 0..1, index} that produce N equal HARD-edged bands. Each band i is
// emitted TWICE — once at its start `i/n`, once at its end `(i+1)/n` — so the
// colour holds flat across the band and flips abruptly at the boundary.
// DOM-free + deterministic so the equal-band / orientation maths is unit-
// testable without a canvas.
export function stripeGradientStops(
	n: number,
): Array<{ offset: number; index: number }> {
	if (n <= 0) return [];
	const stops: Array<{ offset: number; index: number }> = [];
	for (let i = 0; i < n; i++) {
		stops.push({ offset: i / n, index: i });
		stops.push({ offset: (i + 1) / n, index: i });
	}
	return stops;
}

export function createStripeGradient(
	ctx: CanvasRenderingContext2D,
	x: number,
	y: number,
	w: number,
	h: number,
	hues: number[],
	isVertical: boolean,
	alpha?: number,
): CanvasGradient | string {
	if (hues.length === 0) return "gray";
	const fallback = (): string => theme().swatch(hues[0], "fill", alpha);
	// A single hue (or a degenerate box) has no stripe to draw — collapse to a
	// solid swatch, matching createStripePattern's single-hue behaviour.
	if (hues.length === 1 || w <= 0 || h <= 0) return fallback();
	// ∩ vertical → bands along X; ∪ horizontal → bands along Y.
	const grad = isVertical
		? ctx.createLinearGradient(x, y, x + w, y)
		: ctx.createLinearGradient(x, y, x, y + h);
	for (const s of stripeGradientStops(hues.length)) {
		grad.addColorStop(s.offset, theme().swatch(hues[s.index], "fill", alpha));
	}
	return grad;
}
