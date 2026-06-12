import type { GraphData } from "./types";
import type { SortKeyDeps } from "./query-pipeline";
import { getSortKey } from "./query-pipeline";

export interface StreamData {
	rows: string[]; // Tag names
	cols: string[]; // Bin labels (chronological)
	matrix: { r: number; c: number; count: number; nodeIds: string[] }[];
	meta: {
		maxGlobalCol: number;
	};
}

export interface StreamLayoutOptions {
	axisField: string;
	binning: "value" | "month" | "week";
	rowSort: "size" | "first-appearance";
	deps: SortKeyDeps;
}

export function layoutStream(data: GraphData, opts: StreamLayoutOptions): StreamData {
	const { axisField, binning, rowSort, deps } = opts;

	// 1. Assign each node to a bin and collect tag counts
	const binForNode = new Map<string, string>();
	const nodesPerTag = new Map<string, string[]>();
	const uniqueBins = new Set<string>();

	for (const node of data.nodes) {
		const rawKey = getSortKey(node.id, axisField, deps);
		
		let binLabel = "";
		if (binning === "month" || binning === "week") {
			const ts = typeof rawKey === "number" ? rawKey : parseFloat(rawKey as string);
			if (!isNaN(ts) && ts > 0) {
				const d = new Date(ts);
				if (binning === "month") {
					binLabel = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
				} else {
					// ISO week approximation
					const dCopy = new Date(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()));
					const dayNum = dCopy.getUTCDay() || 7;
					dCopy.setUTCDate(dCopy.getUTCDate() + 4 - dayNum);
					const yearStart = new Date(Date.UTC(dCopy.getUTCFullYear(), 0, 1));
					const weekNo = Math.ceil((((dCopy.getTime() - yearStart.getTime()) / 86400000) + 1) / 7);
					binLabel = `${dCopy.getUTCFullYear()}-W${String(weekNo).padStart(2, "0")}`;
				}
			} else {
				binLabel = "Unknown";
			}
		} else {
			binLabel = String(rawKey);
		}

		binForNode.set(node.id, binLabel);
		uniqueBins.add(binLabel);

		for (const m of node.memberships) {
			if (m === "all") continue;
			if (!nodesPerTag.has(m)) nodesPerTag.set(m, []);
			nodesPerTag.get(m)!.push(node.id);
		}
	}

	// 2. Determine and sort columns (bins)
	const cols = Array.from(uniqueBins).sort((a, b) => {
		if (a === "Unknown") return 1;
		if (b === "Unknown") return -1;
		// For strings like "2024-01" or "2024-W05" or numbers, standard string compare works
		return a.localeCompare(b, undefined, { numeric: true });
	});
	const colIndex = new Map(cols.map((c, i) => [c, i]));

	// 3. Determine and sort rows (tags)
	// We might want to cap the number of rows if there are too many.
	const rowData: { tag: string; size: number; firstBin: number }[] = [];
	
	for (const [tag, nodeIds] of nodesPerTag.entries()) {
		let firstBin = Infinity;
		for (const id of nodeIds) {
			const bin = binForNode.get(id);
			if (bin) {
				const c = colIndex.get(bin) ?? Infinity;
				if (c < firstBin) firstBin = c;
			}
		}
		rowData.push({ tag, size: nodeIds.length, firstBin });
	}

	if (rowSort === "first-appearance") {
		rowData.sort((a, b) => {
			if (a.firstBin !== b.firstBin) return a.firstBin - b.firstBin;
			return b.size - a.size; // fallback to size
		});
	} else {
		rowData.sort((a, b) => b.size - a.size);
	}

	// To prevent unreadable matrix, let's cap at 50 rows, keeping the top ones.
	const MAX_ROWS = 50;
	let rows = rowData.map(r => r.tag);
	const excess = rows.length > MAX_ROWS ? rows.slice(MAX_ROWS) : [];
	rows = rows.slice(0, MAX_ROWS);

	// Collect excess tags into a single "...and N more" row if needed
	const OTHERS_ROW = `...and ${excess.length} more`;
	if (excess.length > 0) {
		rows.push(OTHERS_ROW);
	}

	const rowIndex = new Map(rows.map((r, i) => [r, i]));

	// 4. Build matrix
	// Use string key `${r}-${c}` to aggregate counts
	const cellMap = new Map<string, string[]>();
	
	for (const [tag, nodeIds] of nodesPerTag.entries()) {
		let r = rowIndex.get(tag);
		if (r === undefined) {
			if (excess.length > 0 && excess.includes(tag)) {
				r = rowIndex.get(OTHERS_ROW)!;
			} else {
				continue;
			}
		}

		for (const id of nodeIds) {
			const bin = binForNode.get(id);
			if (bin) {
				const c = colIndex.get(bin);
				if (c !== undefined) {
					const key = `${r}-${c}`;
					if (!cellMap.has(key)) cellMap.set(key, []);
					cellMap.get(key)!.push(id);
				}
			}
		}
	}

	const matrix = [];
	for (const [key, nodeIds] of cellMap.entries()) {
		const [rStr, cStr] = key.split("-");
		matrix.push({
			r: parseInt(rStr, 10),
			c: parseInt(cStr, 10),
			count: nodeIds.length,
			nodeIds
		});
	}

	return {
		rows,
		cols,
		matrix,
		meta: {
			maxGlobalCol: cols.length - 1
		}
	};
}
