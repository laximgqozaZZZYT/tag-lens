import assert from "node:assert/strict";
import { test } from "node:test";
import type { AxisSpec } from "../src/layout/axis-layout";
import { shiftAxisSpec } from "../src/layout/axis-shift";

test("shiftAxisSpec returns undefined for an absent spec", () => {
	assert.equal(shiftAxisSpec(undefined, 100), undefined);
});

test("shiftAxisSpec offsets every categorical band field", () => {
	const spec: AxisSpec = {
		kind: "categorical",
		fieldLabel: "tag",
		bands: [
			{ key: "a", label: "A", start: 0, end: 40, center: 20 },
			{ key: "b", label: "B", start: 40, end: 100, center: 70 },
		],
	};
	const out = shiftAxisSpec(spec, 50);
	assert.deepEqual(out?.bands, [
		{ key: "a", label: "A", start: -50, end: -10, center: -30 },
		{ key: "b", label: "B", start: -10, end: 50, center: 20 },
	]);
});

test("shiftAxisSpec offsets every quantitative tick pos, keeps labels/min/max", () => {
	const spec: AxisSpec = {
		kind: "quantitative",
		fieldLabel: "degree",
		min: 0,
		max: 10,
		ticks: [
			{ pos: 0, label: "0.0" },
			{ pos: 30, label: "5.0" },
			{ pos: 60, label: "10.0" },
		],
	};
	const out = shiftAxisSpec(spec, 30);
	assert.equal(out?.min, 0);
	assert.equal(out?.max, 10);
	assert.deepEqual(out?.ticks, [
		{ pos: -30, label: "0.0" },
		{ pos: 0, label: "5.0" },
		{ pos: 30, label: "10.0" },
	]);
});

test("shiftAxisSpec does not mutate the input spec or its arrays", () => {
	const bands = [{ key: "a", label: "A", start: 0, end: 40, center: 20 }];
	const spec: AxisSpec = { kind: "categorical", fieldLabel: "tag", bands };
	const out = shiftAxisSpec(spec, 10);
	assert.notEqual(out, spec);
	assert.notEqual(out?.bands, bands);
	assert.equal(spec.bands?.[0].start, 0);
	assert.equal(bands[0].center, 20);
});

test("shiftAxisSpec with zero offset is an identity clone", () => {
	const spec: AxisSpec = {
		kind: "quantitative",
		fieldLabel: "ageDays",
		ticks: [{ pos: 12, label: "1.0" }],
	};
	const out = shiftAxisSpec(spec, 0);
	assert.deepEqual(out, spec);
	assert.notEqual(out, spec);
});
