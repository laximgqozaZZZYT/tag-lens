// Field-source registry (registration-based; add a field = registerFieldSource()).
// Built-in accessors reuse the intrinsic node fields the parser already produces
// (fmStatus / fmMaturity / mtime / ageDays / memberships) plus ctx lookups.
import type { EncNode, EncContext, FieldSource } from "./types";

export const fieldSourceRegistry: FieldSource[] = [];

export function registerFieldSource(f: FieldSource): void {
	const i = fieldSourceRegistry.findIndex((x) => x.id === f.id);
	if (i >= 0) fieldSourceRegistry[i] = f;
	else fieldSourceRegistry.push(f);
}

// Dynamic field generator: one source per frontmatter key, made on demand so the
// registry doesn't need to enumerate every key in the vault.
export function frontmatterField(key: string): FieldSource {
	return {
		id: `frontmatter:${key}`,
		label: key,
		kind: "categorical", // a quantitative key is detected by the scale via sampling
		accessor: (n: EncNode, ctx: EncContext) => {
			const v = ctx.frontmatterOf?.(n.id)?.[key];
			if (v == null) return null;
			if (typeof v === "number") return v;
			return String(v).trim().toLowerCase();
		},
	};
}

// Resolve a fieldId to a FieldSource, including the dynamic "frontmatter:<key>".
export function resolveFieldSource(fieldId: string): FieldSource | undefined {
	const direct = fieldSourceRegistry.find((f) => f.id === fieldId);
	if (direct) return direct;
	if (fieldId.startsWith("frontmatter:")) {
		const key = fieldId.slice("frontmatter:".length);
		return key ? frontmatterField(key) : undefined;
	}
	return undefined;
}

// ── built-in field sources ───────────────────────────────────────────────────

registerFieldSource({
	id: "maturity",
	label: "Maturity",
	kind: "categorical",
	accessor: (n) => n.fmMaturity ?? null,
});
registerFieldSource({
	id: "ageDays",
	label: "Age (days)",
	kind: "quantitative",
	accessor: (n, ctx) => n.ageDays ?? (n.mtime != null ? (ctx.nowMs - n.mtime) / 86400000 : null),
});
registerFieldSource({
	id: "tag",
	label: "Tag (primary membership)",
	kind: "categorical",
	accessor: (n) => n.memberships?.[0] ?? null,
});
registerFieldSource({
	id: "degree",
	label: "Degree (links + backlinks)",
	kind: "quantitative",
	accessor: (n, ctx) => ctx.degreeOf?.(n.id)?.degree ?? null,
});
registerFieldSource({
	id: "inDegree",
	label: "In-degree (backlinks)",
	kind: "quantitative",
	accessor: (n, ctx) => ctx.degreeOf?.(n.id)?.inDeg ?? null,
});
registerFieldSource({
	id: "outDegree",
	label: "Out-degree (links)",
	kind: "quantitative",
	accessor: (n, ctx) => ctx.degreeOf?.(n.id)?.outDeg ?? null,
});
