// F5 — a renderable legend section, independent of its SOURCE (an encoding
// binding or a mode's intrinsic encoding). drawLegend renders these; builders
// produce them. Pure + DOM-free.
import type { BindingLegend } from "../encoding/evaluate";
import type { NodeShape } from "../encoding/shapes";
import { shapeForKey } from "../encoding/shapes";
import { clamp01 } from "../util/clamp01";

export type LegendKind = "categorical" | "gradient" | "size";

export interface LegendSpec {
	title: string;
	kind: LegendKind;
	entries?: { label: string; color?: string | CanvasPattern; shape?: NodeShape }[];
	ramp?: { stops: string[]; minLabel: string; maxLabel: string };
	sizes?: { label: string; radius: number; color?: string | CanvasPattern }[];
}

// Sequential colour ramp shared by the colour channel AND the legend gradient so
// the bar can never disagree with the nodes. t in [0,1] -> dark(low)..light(high),
// matching channels.ts.
export function sequentialColorRamp(t: number): string {
	const c = clamp01(t);
	return `hsl(210, 70%, ${Math.round(20 + c * 55)}%)`;
}

const fmtNum = (n: number): string => {
	if (!Number.isFinite(n)) return "—";
	const r = Math.round(n * 100) / 100;
	return Object.is(r, -0) ? "0" : String(r);
};

const capitalize = (s: string): string => (s.length ? s[0].toUpperCase() + s.slice(1) : s);

// Convert F4 encoding legends to specs. Categorical -> categorical; quantitative
// -> a 5-stop gradient built from the SAME ramp the colour channel paints.
export function encodingToSpecs(legends: BindingLegend[]): LegendSpec[] {
	const out: LegendSpec[] = [];
	for (const lg of legends) {
		const title = `${capitalize(lg.channelId)} · ${lg.fieldLabel}`;
		const isShape = lg.channelId === "shape";
		if (lg.legend.kind === "quantitative") {
			const stops = [0, 0.25, 0.5, 0.75, 1].map(sequentialColorRamp);
			out.push({ title, kind: "gradient", ramp: { stops, minLabel: fmtNum(lg.legend.min ?? 0), maxLabel: fmtNum(lg.legend.max ?? 0) } });
		} else {
			const all = lg.legend.entries ?? [];
			const entries: { label: string; color?: string; shape?: NodeShape }[] = all.map((e) =>
				isShape ? { label: e.key, shape: shapeForKey(e.key) } : { label: e.key, color: e.output });
			out.push({ title, kind: "categorical", entries });
		}
	}
	return out;
}
