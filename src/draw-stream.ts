import type { LaidOut } from "./layout";
import { clusterHue } from "./canvas-utils";
import type { StreamData } from "./stream-layout";

export interface StreamGeom {
	// Origin of the matrix area
	x0: number;
	y0: number;
	cellSize: number;
	cellGap: number;
	colWidth: number;
	rowHeight: number;
	// Extents
	w: number;
	h: number;
	droppedThreads: { r: number; c: number; tag: string; ageBins: number }[];
}

export function streamGeom(s: StreamData, canvasW: number, canvasH: number): StreamGeom {
	const LABEL_W = 120; // Left margin for row labels
	const LABEL_H = 40;  // Bottom margin for col labels
	const PADDING = 20;

	const availW = canvasW - LABEL_W - PADDING * 2;
	const availH = canvasH - LABEL_H - PADDING * 2;

	const numCols = s.cols.length || 1;
	const numRows = s.rows.length || 1;

	// Distribute width and height
	const cellGap = 2;
	const colWidth = Math.max(10, Math.floor(availW / numCols));
	const rowHeight = Math.max(10, Math.floor(availH / numRows));
	
	// Square cells if possible, or just rectangles
	const cellSize = Math.min(colWidth, rowHeight) - cellGap;

	// Detect dropped threads
	const droppedThreads: { r: number; c: number; tag: string; ageBins: number }[] = [];
	for (let r = 0; r < s.rows.length; r++) {
		// skip the "and N more" row
		if (s.rows[r].startsWith("...and")) continue;

		let maxC = -1;
		let minC = Infinity;
		for (const cell of s.matrix) {
			if (cell.r === r) {
				if (cell.c > maxC) maxC = cell.c;
				if (cell.c < minC) minC = cell.c;
			}
		}

		if (maxC !== -1 && maxC < s.cols.length - 1 && minC < maxC) {
			// Continuous zeros until the end
			const ageBins = (s.cols.length - 1) - maxC;
			droppedThreads.push({ r, c: maxC, tag: s.rows[r], ageBins });
		}
	}

	return {
		x0: PADDING + LABEL_W,
		y0: PADDING,
		cellSize,
		cellGap,
		colWidth,
		rowHeight,
		w: numCols * colWidth,
		h: numRows * rowHeight,
		droppedThreads
	};
}

export function drawStream(
	ctx: CanvasRenderingContext2D,
	laid: LaidOut,
	s: StreamData,
	geom: StreamGeom,
	floorFontPx: number,
	theme: "light" | "dark"
) {
	const txtColor = theme === "dark" ? "#ffffff" : "#000000";
	const txtMuted = theme === "dark" ? "#888888" : "#888888";
	const lineMuted = theme === "dark" ? "#333333" : "#cccccc";

	// 1. Draw row labels (left). `floorFontPx` (= settings.minFontPx) is the
	// lower bound so the user's minimum-font setting is respected here too.
	ctx.font = `${Math.max(floorFontPx, Math.min(14, geom.rowHeight - 4))}px sans-serif`;
	ctx.textBaseline = "middle";
	ctx.textAlign = "right";
	for (let r = 0; r < s.rows.length; r++) {
		const y = geom.y0 + r * geom.rowHeight + geom.rowHeight / 2;
		const label = s.rows[r];
		ctx.fillStyle = label.startsWith("...") ? txtMuted : txtColor;
		// truncate if too long
		let disp = label;
		if (disp.length > 15) disp = disp.substring(0, 14) + "…";
		ctx.fillText(disp, geom.x0 - 10, y);
	}

	// 2. Draw col labels (bottom)
	ctx.font = `${Math.max(floorFontPx, Math.min(12, geom.colWidth - 2))}px sans-serif`;
	ctx.textBaseline = "top";
	ctx.textAlign = "center";
	ctx.fillStyle = txtMuted;
	for (let c = 0; c < s.cols.length; c++) {
		const x = geom.x0 + c * geom.colWidth + geom.colWidth / 2;
		const label = s.cols[c];
		let disp = label;
		if (disp.length > 10) disp = disp.substring(0, 9) + "…";
		ctx.fillText(disp, x, geom.y0 + geom.h + 5);
	}

	// 3. Grid lines (optional, maybe faint)
	ctx.strokeStyle = lineMuted;
	ctx.lineWidth = 1;
	ctx.beginPath();
	for (let c = 0; c <= s.cols.length; c++) {
		ctx.moveTo(geom.x0 + c * geom.colWidth, geom.y0);
		ctx.lineTo(geom.x0 + c * geom.colWidth, geom.y0 + geom.h);
	}
	for (let r = 0; r <= s.rows.length; r++) {
		ctx.moveTo(geom.x0, geom.y0 + r * geom.rowHeight);
		ctx.lineTo(geom.x0 + geom.w, geom.y0 + r * geom.rowHeight);
	}
	ctx.stroke();

	// Find max count for size scaling
	let maxCount = 1;
	for (const cell of s.matrix) {
		if (cell.count > maxCount) maxCount = cell.count;
	}

	// 4. Draw cells
	for (const cell of s.matrix) {
		const cx = geom.x0 + cell.c * geom.colWidth + geom.colWidth / 2;
		const cy = geom.y0 + cell.r * geom.rowHeight + geom.rowHeight / 2;
		
		const rSize = (geom.cellSize / 2) * (0.3 + 0.7 * (cell.count / maxCount));

		// clusterHue returns a hue angle (0–360); wrap it into an HSL colour
		// string. Assigning the raw number to fillStyle silently no-ops.
		const hue = clusterHue(s.rows[cell.r]);
		ctx.fillStyle = `hsl(${hue}, 65%, 55%)`;
		ctx.beginPath();
		ctx.arc(cx, cy, rSize, 0, Math.PI * 2);
		ctx.fill();

		// Add count text if big enough
		if (rSize > 8 && cell.count > 0) {
			ctx.fillStyle = "#ffffff";
			ctx.font = `bold ${Math.max(floorFontPx, rSize)}px sans-serif`;
			ctx.textBaseline = "middle";
			ctx.textAlign = "center";
			ctx.fillText(String(cell.count), cx, cy);
		}
	}

	// 5. Draw Dropped Threads markers
	ctx.fillStyle = "#ff4444"; // Warning red
	for (const thread of geom.droppedThreads) {
		const cx = geom.x0 + thread.c * geom.colWidth + geom.colWidth / 2;
		const cy = geom.y0 + thread.r * geom.rowHeight + geom.rowHeight / 2;
		
		const mx = cx + geom.cellSize / 2 + 6;
		const my = cy;

		// Draw triangle ▷
		ctx.beginPath();
		ctx.moveTo(mx, my - 4);
		ctx.lineTo(mx + 6, my);
		ctx.lineTo(mx, my + 4);
		ctx.closePath();
		ctx.fill();
	}
}
