import {
	CARD_CELL_W,
	CARD_CELL_H,
	CARD_PAD_X,
	CARD_PAD_Y,
	CARD_LINE_HEIGHT_PX,
	CARD_BODY_LINE_HEIGHT_PX,
	CARD_BODY_FONT_PX,
	CARD_TITLE_FONT_PX,
	CARD_TITLE_BODY_GAP,
} from "../types";
import { wrapText } from "../draw/canvas-utils";

// Multiplier that grows the card area to accommodate a user-imposed
// minimum font size. When `minFontPx <= CARD_TITLE_FONT_PX` the cards
// are unchanged; above that, both cells and padding grow uniformly so
// the title row stays inside the card at every zoom.
export function minFontScale(minFontPx: number): number {
	if (!minFontPx || minFontPx <= CARD_TITLE_FONT_PX) return 1;
	return minFontPx / CARD_TITLE_FONT_PX;
}

// What an individual card carries through the (id, mode, scale) cache.
// `width` / `height` are the FINAL pixel dimensions (= what layout sees);
// `bodyLines` is the already-wrapped + already-clipped body text ready
// to render. Storing both means the renderer never re-measures.
export interface CardContent {
	title: string;
	body: string;
	bodyLines: string[];
	width: number;
	height: number;
}

// Pure size computation: row × column slot count, scale factor, and the
// row / column channel widths produce the final card pixel size. The
// channel is subtracted at the end so a 1×1 card fits exactly inside
// one slot WITHOUT eating the channel — the visible gap stays uniform.
//
// Bug-fix anchor: Bug #1 ("group members spread") routes through here
// when a per-cluster NODE_DISPLAY override inflates rows/cols. A larger
// card pushes neighbouring sub-groups further apart in cell-snap,
// which then propagates up to the cluster bbox. Keeping this function
// pure means we can dump (rows, cols, scaleFactor) for every node and
// inspect the produced size directly.
export interface CardSizeOptions {
	rows: number;
	cols: number;
	channelW: number;
	channelH: number;
	scaleFactor: number;
	// User-configured floor for screen-space font size. Cards (and
	// therefore the grid lattice) need to grow when the floor exceeds
	// the native title font, otherwise the rendered text overflows.
	minFontPx?: number;
}

export function computeCardSize(opts: CardSizeOptions): {
	width: number;
	height: number;
} {
	const fs = minFontScale(opts.minFontPx ?? 0);
	const slotW = CARD_CELL_W * fs + opts.channelW;
	const slotH = CARD_CELL_H * fs + opts.channelH;
	const effC = opts.cols * opts.scaleFactor;
	const effR = opts.rows * opts.scaleFactor;
	return {
		width: effC * slotW - opts.channelW,
		height: effR * slotH - opts.channelH,
	};
}

// `nodeSpacing` setting controls BOTH the horizontal and vertical
// channel width — kept symmetric so row separations between cards are
// as visible as column separations. (Earlier versions scaled channelH
// by the card aspect ratio, which made vertical channels look cramped.)
//
// `fontScale` (= `minFontScale(minFontPx)`) scales the 隘路 in lockstep
// with the cell + card, so the WHOLE grid grows proportionally with the
// Min font size setting. Without it, raising the font floor grew the
// cards but left the gaps thin, making the layout look cramped.
export function computeChannelDims(
	nodeSpacing: number,
	fontScale = 1,
): {
	channelW: number;
	channelH: number;
} {
	// Keep in sync with layout.ts: floor 24, multiplier 1.5×, both axes
	// equal so the cell grid breathing room reads symmetrically.
	const channelW = Math.max(24, Math.floor(nodeSpacing * 1.5)) * fontScale;
	const channelH = channelW;
	return { channelW, channelH };
}



// Wrap title + body into the card's inner area. `scale` here is the
// SAME visualScale that the renderer uses, so the line counts produced
// here match exactly what fits at render time.
//
// `ctx` is a 2D context used solely for `measureText` — passing the
// view's main canvas context is fine because the font / textBaseline
// are restored each draw.
export interface MeasureCardOptions {
	title: string;
	body: string;
	mode: "full" | "brief";
	cardW: number;
	cardH: number;
	scale: number;
	showBody: boolean;
}

export function measureCard(
	ctx: CanvasRenderingContext2D,
	opts: MeasureCardOptions,
): CardContent {
	const { title, body, mode, cardW, cardH, scale, showBody } = opts;
	// Wrap at BASE font (= 10 px). Render-time scaling multiplies both
	// width and font size, so wrap_width × scale must fit the SCALED
	// inner width (= cardW − 2·padX·scale). Solving for wrap_width
	// gives the formula below — same logic for the vertical budget.
	const wrapWidth = Math.max(8, cardW / scale - 2 * CARD_PAD_X);
	const innerHBase = cardH / scale - 2 * CARD_PAD_Y;
	const availBodyBase =
		innerHBase - CARD_LINE_HEIGHT_PX - CARD_TITLE_BODY_GAP;
	const maxLines = Math.max(
		0,
		Math.floor(availBodyBase / CARD_BODY_LINE_HEIGHT_PX),
	);
	const effectiveBody = mode === "brief" || !showBody ? "" : body;
	ctx.font = `${CARD_BODY_FONT_PX}px sans-serif`;
	const allLines = effectiveBody ? wrapText(ctx, effectiveBody, wrapWidth) : [];
	const bodyLines = allLines.slice(0, maxLines);
	return {
		title,
		body,
		bodyLines,
		width: cardW,
		height: cardH,
	};
}
