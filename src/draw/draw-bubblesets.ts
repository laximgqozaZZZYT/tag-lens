import type { ClusterRect } from "../layout/layout";
import { theme, colorAlpha } from "./theme";
import { clusterHue, createStripeGradient } from "./canvas-utils";

export function drawBubbleSetsEnclosures(
	ctx: CanvasRenderingContext2D,
	clusters: ClusterRect[],
	highlightedClusters: Set<string>,
	warningClusters: Set<string> | undefined,
	zoom: number,
	hoverPos: { x: number; y: number } | null = null,
): void {
	// Hide "ghost" single-node enclosures (a stray 1-cell box around a
	// multi-tag card that lives in another cluster) — they read as
	// scattered noise. Enclosures holding a single-TAG card are kept.
	const sortedClusters = [...clusters]
		.filter((c) => !c.ghostSingle)
		.sort((a, b) => b.width * b.height - a.width * a.height);
	const strokeW = 1.6 / zoom;
	const accentStrokeW = 3.2 / zoom;

	// Pass 1: fills.
	for (const c of sortedClusters) {
		const hue = clusterHue(c.groupKey);
		const isHigh = highlightedClusters.has(c.groupKey);
		const isWarn = warningClusters?.has(c.groupKey);
		ctx.fillStyle = isHigh
			? colorAlpha(theme().warn, 0.40)
			: isWarn
			? colorAlpha(theme().warn, 0.20)
			: theme().swatch(hue, "tint", 0.32);
		
		if (c.pieces && c.pieces.length > 0) {
			// Contour rings are lines only (no fill) — fill the solid mains.
			const mains = c.pieces.filter((p) => p.kind === "main" && !p.contour);
			if (mains.length > 0) {
				ctx.beginPath();
				for (const p of mains) ctx.rect(p.x, p.y, p.w, p.h);
				ctx.fill();
			}
			// Intersection (積集合) sub-boxes always keep their OWN colour
			// (keyed by the intersection signature) so they read as distinct
			// from the single-set box that contains them — even on hover.
			for (const p of c.pieces) {
				if (p.kind !== "sub") continue;
				// An intersection (積集合) sub-box spanning >=2 tags is striped
				// with one equal band per parent-set colour — ∩ => VERTICAL bars, one
				// cycle across the box (matching the node / lattice look) — instead of
				// a single blended hue. Single-tag exclaves keep their solid swatch.
				if (p.hueKeys && p.hueKeys.length > 1) {
					const hues = p.hueKeys.map((k) => clusterHue(k));
					ctx.fillStyle = createStripeGradient(
						ctx, p.x, p.y, p.w, p.h, hues, /*isVertical=*/ true, 0.42,
					);
				} else {
					const sh = clusterHue(p.hueKey ?? c.groupKey);
					ctx.fillStyle = theme().swatch(sh, "fill", 0.42);
				}
				ctx.beginPath();
				ctx.rect(p.x, p.y, p.w, p.h);
				ctx.fill();
			}
		} else if (c.cells && c.cells.length > 0) {
			ctx.beginPath();
			for (const cell of c.cells) ctx.rect(cell.x, cell.y, cell.w, cell.h);
			ctx.fill();
		}
	}

	// Pass 2: outlines.
	const dashLen = 6 / zoom;
	const dashGap = 4 / zoom;
	for (const c of sortedClusters) {
		const hue = clusterHue(c.groupKey);
		const isHigh = highlightedClusters.has(c.groupKey);
		const isWarn = warningClusters?.has(c.groupKey);
		ctx.strokeStyle = isHigh
			? theme().warn
			: isWarn
			? colorAlpha(theme().warn, 0.8)
			: theme().swatch(hue, "fill", 0.9);
		ctx.lineWidth = isHigh ? accentStrokeW : isWarn ? strokeW * 1.5 : strokeW;
		
		if (c.pieces && c.pieces.length > 0) {
			for (const p of c.pieces) {
				if (p.kind === "main") {
					// Glowing iso-contour: wide translucent halo + bright core.
					ctx.setLineDash([]);
					ctx.strokeStyle = isHigh
						? colorAlpha(theme().warn, 0.35)
						: theme().swatch(hue, "fill", 0.30);
					ctx.lineWidth = 8 / zoom;
					ctx.strokeRect(p.x, p.y, p.w, p.h);
					ctx.strokeStyle = isHigh ? theme().warn : theme().swatch(hue, "fillStrong", 1);
					ctx.lineWidth = 2.2 / zoom;
					ctx.strokeRect(p.x, p.y, p.w, p.h);
					continue;
				}
				
				let pHigh: boolean;
				if (p.kind === "sub") {
					ctx.setLineDash([dashLen, dashGap]);
					// Accent a sub-box only when its single-set box is highlighted
					// AND (no node is hovered OR the hovered node sits inside it).
					pHigh =
						isHigh &&
						(!hoverPos ||
							(hoverPos.x >= p.x &&
								hoverPos.x <= p.x + p.w &&
								hoverPos.y >= p.y &&
								hoverPos.y <= p.y + p.h));
					const sh = clusterHue(p.hueKey ?? c.groupKey);
					ctx.strokeStyle = pHigh ? theme().warn : theme().swatch(sh, "stroke", 0.95);
				} else {
					ctx.setLineDash([]);
					pHigh = isHigh;
					ctx.strokeStyle = pHigh ? theme().warn : theme().swatch(hue, "fill", 0.9);
				}
				ctx.lineWidth = pHigh ? accentStrokeW : strokeW;
				ctx.strokeRect(p.x, p.y, p.w, p.h);
			}
			ctx.setLineDash([]);
		} else if (c.outline && c.outline.length > 0) {
			ctx.beginPath();
			for (const seg of c.outline) {
				ctx.moveTo(seg.x1, seg.y1);
				ctx.lineTo(seg.x2, seg.y2);
			}
			ctx.stroke();
		} else {
			ctx.strokeRect(c.x, c.y, c.width, c.height);
		}
	}
}
