import { theme } from "./theme";
import type { PositionedNode } from "./layout";
import {
	CARD_RADIUS_PX,
	CARD_PAD_X,
	CARD_PAD_Y,
	CARD_BODY_FONT_PX,
	CARD_LINE_HEIGHT_PX,
	CARD_BODY_LINE_HEIGHT_PX,
	CARD_TITLE_BODY_GAP,
} from "./types";
import {
	roundedRectPath,
	truncateToWidth,
	floorWorldFontPx,
} from "./canvas-utils";

// Wrapped + truncated body lines for a card. Computed once by
// `cardFor()` / measureCard, then cached under the (id, mode, scale)
// composite key.
export interface CardBodyCacheEntry {
	bodyLines: string[];
}

export interface DrawCardOptions {
	scale: number;
	bodyLines: string[];
	showBody: boolean;
	highlighted: boolean;
	zoom: number;
	// User-configured minimum SCREEN font size. World-space fonts that
	// would render smaller than this under the current zoom get their
	// world unit bumped up so the actual screen size stays ≥ minFontPx.
	minFontPx: number;
	// When set, fill the card with this hue (bipartite SET / tag nodes) so it
	// reads as a coloured set node rather than a plain dark note card.
	fillHue?: number;
	// When set (and not a SET node), fill the card with a MUTED tint of this hue
	// — used by the clustered bipartite layout so each island's notes read as
	// one calm coloured mass rather than blue-grey dots.
	tintHue?: number;
	// LOD threshold (screen px): when set, the title is drawn only if the card's
	// on-screen width (width × zoom) is at least this. Below it the card is a
	// bare coloured marker — no title, no lone "…". Used by clustered bipartite.
	titleLodPx?: number;
	
	// Visual Encoding (Opacity channel): override global alpha.
	encOpacity?: number;

	// Visual Encoding (Border channel): resolved stroke colour.
	encBorderColor?: string;

	// Note Maturity
	fmMaturity?: string;
	showMaturity?: boolean;

	// Visual Encoding (Color channel): resolved fill colour for a NOTE card.
	// Additive — when absent the card keeps its default background.
	encFillColor?: string;
}

// Pure card renderer. Receives the already-resolved scale + body lines
// instead of looking them up by node id, so this function has zero
// dependence on view state. Bug-fix anchor: when a per-cluster
// NODE_DISPLAY override resized a card but the font stayed at the
// global default, the bug lived in the SCALE the caller passed — not
// here. Keeping the function pure makes that diagnosis trivial.
//
// Width / height come from `n.width`, `n.height` (set by layout); the
// caller must NOT pre-scale them. Stroke width and corner radius stay
// FIXED in screen pixels (divided by zoom) so the card outline reads
// identically regardless of card size or zoom level.
export function drawCard(
	ctx: CanvasRenderingContext2D,
	n: PositionedNode,
	opts: DrawCardOptions,
): void {
	const { scale, bodyLines, showBody, highlighted, zoom, minFontPx, fillHue, tintHue } = opts;
	const isSet = fillHue != null;
	const isTint = !isSet && tintHue != null;
	const x = n.x - n.width / 2;
	const y = n.y - n.height / 2;
	const w = n.width;
	const h = n.height;
	const r = Math.min(CARD_RADIUS_PX, w / 2, h / 2);

	ctx.save();
	if (opts.encOpacity != null) {
		ctx.globalAlpha = opts.encOpacity;
	}
	if (n.isPeripheral) {
		ctx.globalAlpha *= 0.5;
	}

	// Fill first so the stroke below sits cleanly on top.
	ctx.beginPath();
	roundedRectPath(ctx, x, y, w, h, r);
	ctx.fillStyle = highlighted
		? theme().warn
		: isSet
			? theme().swatch(fillHue, "fill")
			: isTint
				? theme().swatch(tintHue, "tint")
				: (opts.encFillColor ?? theme().canvasBgAlt);
	ctx.fill();

	ctx.lineWidth = (highlighted ? 1.8 : isSet ? 1.6 : 1) / zoom;
	ctx.strokeStyle = highlighted
		? theme().warn
		: isSet
			? theme().swatch(fillHue, "fillStrong")
			: isTint
				? theme().swatch(tintHue, "fill")
				: theme().accent;
	if (n.isPeripheral) {
		ctx.setLineDash([4 / zoom, 4 / zoom]);
	}
	ctx.beginPath();
	roundedRectPath(ctx, x, y, w, h, r);
	ctx.stroke();
	ctx.setLineDash([]);

	if (opts.encBorderColor && !isSet) {
		ctx.lineWidth = 2 / zoom;
		ctx.strokeStyle = opts.encBorderColor;
		ctx.beginPath();
		roundedRectPath(ctx, x, y, w, h, r);
		ctx.stroke();
	}

	if (opts.showMaturity && opts.fmMaturity && !isSet) {
		ctx.beginPath();
		const badgeR = 4 / zoom;
		const badgeX = x + badgeR + 2 / zoom;
		const badgeY = y + badgeR + 2 / zoom;
		ctx.arc(badgeX, badgeY, badgeR, 0, 2 * Math.PI);
		if (opts.fmMaturity === "fleeting") {
			ctx.fillStyle = theme().canvasBgAlt; // grey
		} else if (opts.fmMaturity === "literature") {
			ctx.fillStyle = "#4a90e2"; // blue
		} else if (opts.fmMaturity === "permanent") {
			ctx.fillStyle = "#50e3c2"; // green
		}
		ctx.fill();
		ctx.lineWidth = 1 / zoom;
		ctx.strokeStyle = theme().accent;
		ctx.stroke();
	}

	// Internal metrics all scale together — padding, font sizes, line
	// heights, gap. Sole source of truth for "what scale does to a card"
	// lives in `visualScale()` + this multiplication.
	const padX = CARD_PAD_X * scale;
	const padY = CARD_PAD_Y * scale;
	const innerW = Math.max(0, w - 2 * padX);
	const innerH = Math.max(0, h - 2 * padY);
	// Title font = the LARGEST size whose rendered glyphs fit the node's
	// inner WIDTH and HEIGHT (measured at the real 600 weight), so the title
	// fills the node right up to its edges and grows with it. A screen-space
	// lower bound (Min font size) is then applied; if that bound pushes the
	// font past the width, the title is truncated (clip + ellipsis) below.
	// Euler + UpSet share this renderer, so both views are covered.
	ctx.font = "600 100px sans-serif";
	const m100 = ctx.measureText(n.label);
	const w100 = m100.width || 1;
	const h100 =
		(m100.actualBoundingBoxAscent || 72) + (m100.actualBoundingBoxDescent || 20);
	// Width target leaves a 4% margin so the WHOLE title fits without the
	// truncate-to-width below clipping its last glyph; height fills the cell.
	const titleFontPx = floorWorldFontPx(
		Math.min((innerH * 100) / h100, (innerW * 96) / w100),
		minFontPx,
		zoom,
	);
	const bodyFontPx = Math.min(
		floorWorldFontPx(CARD_BODY_FONT_PX * scale, minFontPx, zoom),
		innerH,
	);
	const titleLineH = CARD_LINE_HEIGHT_PX * scale;
	const bodyLineH = CARD_BODY_LINE_HEIGHT_PX * scale;
	const titleBodyGap = CARD_TITLE_BODY_GAP * scale;
	const innerLeft = x + padX;
	const innerTop = y + padY;

	// Clip ALL text to the card rectangle so nothing — an over-floored
	// font, a long body line — can render outside the node boundary.
	ctx.save();
	ctx.beginPath();
	roundedRectPath(ctx, x, y, w, h, r);
	ctx.clip();

	ctx.textAlign = "start";

	// LOD: below the threshold the card stays a bare coloured marker — drawing
	// the title (which would collapse to a lone "…") is skipped. Above it, the
	// title is shown, truncated with "…" when long (full text on hover).
	const showTitle = opts.titleLodPx == null || w * zoom >= opts.titleLodPx;
	if (showTitle) {
		ctx.font = `600 ${titleFontPx}px sans-serif`;
		ctx.fillStyle = highlighted ? "#1d1100" : theme().textNormal;
		const titleFitted = truncateToWidth(ctx, n.label, innerW);
		// Title-only cards: centre the title vertically so the enlarged glyphs
		// sit flush in the node. (Body preview was retired.)
		ctx.textBaseline = "middle";
		ctx.fillText(titleFitted, innerLeft, y + h / 2);
	}

	ctx.textBaseline = "top";
	if (bodyLines.length > 0 && showBody) {
		ctx.font = `${bodyFontPx}px sans-serif`;
		ctx.fillStyle = highlighted ? "#3a2400" : theme().textMuted;
		// Offset below the ACTUAL title height (the capped font may exceed
		// the nominal line height at low zoom) so the body never overlaps
		// the title; the clip drops any line that runs past the card.
		let ly = innerTop + Math.max(titleLineH, titleFontPx) + titleBodyGap;
		for (const line of bodyLines) {
			ctx.fillText(line, innerLeft, ly);
			ly += bodyLineH;
		}
	}
	ctx.restore(); // Restores the text clip
	ctx.restore(); // Restores the globalAlpha (from line 87)
}
