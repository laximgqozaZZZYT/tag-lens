import assert from "node:assert/strict";
import test from "node:test";
import { DEFAULT_SETTINGS } from "../src/types";
import { DISPLAY_ONLY_KEYS, layoutSignature } from "../src/layout/layout-signature";

test("layout signature is stable regardless of key insertion order", () => {
	const a = { ...DEFAULT_SETTINGS };
	// A shuffled shallow copy (different key order) must sign identically.
	const shuffled = Object.fromEntries(
		Object.entries(DEFAULT_SETTINGS).reverse(),
	) as unknown as typeof DEFAULT_SETTINGS;
	assert.equal(layoutSignature(a), layoutSignature(shuffled));
});

test("toggling any DISPLAY_ONLY key leaves the signature unchanged", () => {
	const base = layoutSignature(DEFAULT_SETTINGS);
	for (const key of DISPLAY_ONLY_KEYS) {
		const rec = { ...DEFAULT_SETTINGS } as unknown as Record<string, unknown>;
		// Flip booleans; for the non-boolean heatmap scale, flip its value too.
		rec[key] = typeof rec[key] === "boolean" ? !rec[key] : `mutated:${rec[key]}`;
		assert.equal(
			layoutSignature(rec as unknown as typeof DEFAULT_SETTINGS),
			base,
			`display-only key ${key} must not change the layout signature`,
		);
	}
});

test("toggling a layout-affecting key changes the signature", () => {
	const base = layoutSignature(DEFAULT_SETTINGS);
	// `viewMode` drives placement and is not display-only (default is "heatmap").
	const changed = { ...DEFAULT_SETTINGS, viewMode: "lattice" as const };
	assert.notEqual(layoutSignature(changed), base);
});

test("every DISPLAY_ONLY key is a real settings field", () => {
	const rec = DEFAULT_SETTINGS as unknown as Record<string, unknown>;
	for (const key of DISPLAY_ONLY_KEYS) {
		assert.ok(key in rec, `DISPLAY_ONLY key ${key} is not a real settings field`);
	}
});

test("signature excludes exactly the display-only keys", () => {
	const parsed = JSON.parse(layoutSignature(DEFAULT_SETTINGS)) as Record<string, unknown>;
	for (const key of DISPLAY_ONLY_KEYS) {
		assert.ok(!(key in parsed), `${key} should be dropped from the signature`);
	}
	// A representative layout key survives.
	assert.ok("viewMode" in parsed);
});

test("layoutSignature does not mutate its input", () => {
	const snapshot = JSON.stringify(DEFAULT_SETTINGS);
	layoutSignature(DEFAULT_SETTINGS);
	assert.equal(JSON.stringify(DEFAULT_SETTINGS), snapshot);
});
