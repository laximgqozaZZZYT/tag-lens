// Tiny zero-dependency assertion helpers. Throw on failure; the runner
// (test/run.mjs) catches, prints, and exits non-zero.
let passed = 0;
export function ok(cond: boolean, msg: string): void {
	if (!cond) throw new Error(`FAIL: ${msg}`);
	passed++;
}
export function eq<T>(actual: T, expected: T, msg: string): void {
	ok(actual === expected, `${msg} — expected ${String(expected)}, got ${String(actual)}`);
}
export function approx(actual: number, expected: number, eps: number, msg: string): void {
	ok(Math.abs(actual - expected) <= eps, `${msg} — expected ≈${expected} (±${eps}), got ${actual}`);
}
export function summary(): number {
	console.log(`\n${passed} assertions passed`);
	return passed;
}
