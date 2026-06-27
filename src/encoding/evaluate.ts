// Evaluation pipeline: given the ALREADY-SELECTED nodes + user bindings, produce
// per-node draw params. INVARIANT: this never adds/removes/mutates nodes — it
// only reads attributes and writes a separate NodeDrawParams map. Selection is
// the SQL/DataviewJS layer's job, never this one.
import { resolveFieldSource } from "./field-sources";
import { resolveChannel } from "./channels";
import { prepareScale, type LegendInfo } from "./scales";
import type {
	EncNode,
	EncContext,
	EncodingBinding,
	FieldKind,
	NodeDrawParams,
	ScaleConfig,
} from "./types";
import type { ViewMode } from "../types";

export interface BindingLegend {
	channelId: string;
	fieldId: string;
	fieldLabel: string;
	legend: LegendInfo;
}
export interface EncodingResult {
	params: Map<string, NodeDrawParams>;
	legends: BindingLegend[];
}

function defaultScaleFor(kind: FieldKind): ScaleConfig {
	return kind === "quantitative" || kind === "temporal"
		? { type: "linear" }
		: { type: "categorical" };
}

export function evaluateEncoding(
	nodes: EncNode[],
	bindings: EncodingBinding[],
	ctx: EncContext,
	mode?: ViewMode,
): EncodingResult {
	const params = new Map<string, NodeDrawParams>();
	const ensure = (id: string): NodeDrawParams => {
		let p = params.get(id);
		if (!p) {
			p = {};
			params.set(id, p);
		}
		return p;
	};
	const legends: BindingLegend[] = [];

	for (const b of bindings) {
		if (!b.enabled) continue;
		const field = resolveFieldSource(b.fieldId);
		const channel = resolveChannel(b.channelId);
		if (!field || !channel) continue; // unknown id -> skip gracefully
		if (mode && !channel.appliesTo(mode)) continue; // per-mode policy (single point)

		const scaleCfg = b.scale ?? defaultScaleFor(field.kind);
		const raws = nodes.map((n) => field.accessor(n, ctx)); // reads only; nodes untouched
		const scale = prepareScale(scaleCfg, raws);
		nodes.forEach((n, i) => { channel.apply(ensure(n.id), scale.apply(raws[i]), ctx); });
		legends.push({ channelId: b.channelId, fieldId: b.fieldId, fieldLabel: field.label, legend: scale.legend });
	}

	return { params, legends };
}
