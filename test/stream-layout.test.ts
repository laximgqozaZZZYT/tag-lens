import { test } from "node:test";
import * as assert from "node:assert";
import { layoutStream } from "../src/layout/stream-layout";
import type { GraphData } from "../src/types";
import { TFile } from "obsidian";

test("layoutStream bins nodes by month", () => {
	const data: GraphData = {
		nodes: [
			{ id: "A", label: "A", memberships: ["tag:tech"], mtime: new Date("2024-01-15").getTime(), aliases: [] },
			{ id: "B", label: "B", memberships: ["tag:tech"], mtime: new Date("2024-02-10").getTime(), aliases: [] },
			{ id: "C", label: "C", memberships: ["tag:tech", "tag:art"], mtime: new Date("2024-02-20").getTime(), aliases: [] },
		],
		edges: []
	};

	const deps = {
		app: {
			vault: {
				getAbstractFileByPath: (id: string) => {
					const node = data.nodes.find(n => n.id === id);
					return Object.assign(new TFile(), {
						path: id,
						basename: id,
						extension: "md",
						stat: { mtime: node?.mtime ?? 0, ctime: node?.mtime ?? 0, size: 100 }
					});
				}
			}
		} as any,
		degreeMap: new Map(),
		membershipsOf: (id: string) => data.nodes.find(n => n.id === id)?.memberships ?? []
	};

	const s = layoutStream(data, {
		axisField: "mtime",
		binning: "month",
		rowSort: "size",
		deps
	});

	assert.deepStrictEqual(s.rows, ["tag:tech", "tag:art"]);
	assert.deepStrictEqual(s.cols, ["2024-01", "2024-02"]);

	assert.strictEqual(s.matrix.length, 3);
	
	const tech_01 = s.matrix.find(m => s.rows[m.r] === "tag:tech" && s.cols[m.c] === "2024-01");
	assert.ok(tech_01);
	assert.strictEqual(tech_01.count, 1);
	assert.deepStrictEqual(tech_01.nodeIds, ["A"]);

	const tech_02 = s.matrix.find(m => s.rows[m.r] === "tag:tech" && s.cols[m.c] === "2024-02");
	assert.ok(tech_02);
	assert.strictEqual(tech_02.count, 2);
	assert.deepStrictEqual(tech_02.nodeIds, ["B", "C"]);

	const art_02 = s.matrix.find(m => s.rows[m.r] === "tag:art" && s.cols[m.c] === "2024-02");
	assert.ok(art_02);
	assert.strictEqual(art_02.count, 1);
	assert.deepStrictEqual(art_02.nodeIds, ["C"]);
});

test("layoutStream handles missing mtime", () => {
	const data: GraphData = {
		nodes: [
			{ id: "A", label: "A", memberships: ["tag:tech"], aliases: [] }, // no mtime
		],
		edges: []
	};

	const deps = {
		app: {
			vault: {
				getAbstractFileByPath: (id: string) => {
					const node = data.nodes.find(n => n.id === id);
					return Object.assign(new TFile(), {
						path: id,
						basename: id,
						extension: "md",
						stat: { mtime: node?.mtime ?? 0, ctime: node?.mtime ?? 0, size: 100 }
					});
				}
			}
		} as any,
		degreeMap: new Map(),
		membershipsOf: (id: string) => data.nodes.find(n => n.id === id)?.memberships ?? []
	};

	const s = layoutStream(data, {
		axisField: "mtime",
		binning: "month",
		rowSort: "size",
		deps
	});

	assert.deepStrictEqual(s.cols, ["Unknown"]);
	assert.strictEqual(s.matrix[0].count, 1);
});
