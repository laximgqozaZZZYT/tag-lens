// Backward-compat: express the legacy one-off overlays as encoding bindings so
// existing vaults keep their look without a saved `settings.encoding`.
// First scope = Status overlay -> color binding. Freshness(opacity) /
// maturity(shape) / degree(size) join here as those channels land.
import type { EncodingBinding } from "./types";

// Only the legacy fields this synthesizer reads (decoupled from full MiniSettings
// so it stays unit-testable).
export interface LegacyEncodingSettings {
	statusField?: string;
	statusColors?: Record<string, string>;
	nodeSizeMode?: "fixed" | "indegree" | "outdegree";
	freshnessOverlay?: boolean;
	staleDays?: number;
}

export function synthesizeEncodingFromLegacy(s: LegacyEncodingSettings): EncodingBinding[] {
	const out: EncodingBinding[] = [];
	if (s.statusField && s.statusField.trim()) {
		out.push({
			channelId: "border",
			fieldId: "frontmatter:" + s.statusField,
			scale: { type: "categorical", palette: { ...(s.statusColors ?? {}) } },
			enabled: true,
		});
	}
	if (s.nodeSizeMode && s.nodeSizeMode !== "fixed") {
		out.push({
			channelId: "size",
			fieldId: s.nodeSizeMode === "indegree" ? "inDegree" : "outDegree",
			scale: { type: "linear", domain: [0, 3] }, // replicates Math.min(4, degree + 1)
			enabled: true,
		});
	}
	if (s.freshnessOverlay) {
		out.push({
			channelId: "opacity",
			fieldId: "ageDays",
			scale: { type: "linear", domain: [0, s.staleDays ?? 30] },
			enabled: true,
		});
	}
	return out;
}

// What the renderer should actually use: an explicit user encoding always wins;
// otherwise fall back to the legacy-derived one. Never persisted — computed live.
export function effectiveEncoding(
	encoding: EncodingBinding[] | undefined,
	legacy: LegacyEncodingSettings,
): EncodingBinding[] {
	if (encoding && encoding.length > 0) return encoding;
	return synthesizeEncodingFromLegacy(legacy);
}
