import { clusterHue } from "./canvas-utils";

export function resolveStatusColor(fmValue: unknown, colors: Record<string, string>): string | null {
	if (fmValue === undefined || fmValue === null) return null;
	const key = String(fmValue).trim().toLowerCase();
	if (!key) return null;
	return colors[key] || null;
}

function hslToHex(h: number, s: number, l: number): string {
	l /= 100;
	const a = s * Math.min(l, 1 - l) / 100;
	const f = (n: number) => {
		const k = (n + h / 30) % 12;
		const color = l - a * Math.max(Math.min(k - 3, 9 - k, 1), -1);
		return Math.round(255 * color).toString(16).padStart(2, '0');
	};
	return `#${f(0)}${f(8)}${f(4)}`;
}

export function autoAssignColors(values: string[]): Record<string, string> {
	const result: Record<string, string> = {};
	for (const v of values) {
		const key = String(v).trim().toLowerCase();
		if (!key) continue;
		if (!result[key]) {
			const hue = clusterHue(key);
			result[key] = hslToHex(hue, 85, 60);
		}
	}
	return result;
}
