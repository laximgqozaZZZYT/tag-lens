// Visual Encoding Engine — core types (DOM-free, no Obsidian imports).
//
// SEPARATION OF CONCERNS (non-negotiable): this layer maps already-selected
// nodes' ATTRIBUTES to VISUAL CHANNELS. It NEVER decides which notes appear —
// that is the SQL/DataviewJS filter layer's job. See docs/design-encoding-engine.md.
import type { ViewMode } from "../types";

export type FieldKind = "categorical" | "quantitative" | "temporal" | "ordinal";

// The minimal node shape the encoding layer reads. Compatible with GraphNode /
// PositionedNode (both already carry these intrinsic fields). Obsidian-dependent
// lookups (frontmatter, degree) are isolated in EncContext so this file never
// imports Obsidian.
export interface EncNode {
	id: string;
	label?: string;
	memberships: string[];
	mtime?: number;
	ageDays?: number;
	fmMaturity?: string;
	isPeripheral?: boolean;
}

// Side data the accessors may need, injected by the caller (view.ts wires it).
export interface EncContext {
	nowMs: number;
	degreeOf?: (id: string) => { inDeg: number; outDeg: number; degree: number } | undefined;
	frontmatterOf?: (id: string) => Record<string, unknown> | undefined;
}

// A bindable data attribute.
export interface FieldSource {
	id: string; // "status" | "ageDays" | "tag" | "degree" | "frontmatter:<key>" | ...
	label: string;
	kind: FieldKind;
	accessor: (node: EncNode, ctx: EncContext) => string | number | null;
}

// Scale config (semantics implemented in P1 scales.ts).
export type ScaleType = "linear" | "log" | "quantile" | "ordinal" | "categorical";
export interface ScaleConfig {
	type: ScaleType;
	domain?: [number, number] | "auto"; // quantitative
	palette?: Record<string, string>; // categorical: value -> output (hex). empty => auto-assigned
	reverse?: boolean;
	clampPctl?: number; // e.g. 0.95 — clamp the quantitative domain at this percentile
}

// Result of scaling one node's raw value. The SCALE turns data -> normalized
// (`t` 0..1) or category (+ resolved `output` when a palette maps it); the
// CHANNEL turns this into concrete NodeDrawParams. `missing` = raw was null.
export interface ScaledValue {
	t?: number;
	category?: string;
	output?: string;
	missing?: boolean;
}

// Per-node draw parameters the renderer reads. Channels write here. Extensible:
// a new channel adds a field (size/opacity/icon/... already reserved below).
export interface NodeDrawParams {
	fillColor?: string;
	fillHue?: number;
	sizeScale?: number;
	opacity?: number;
	icon?: string;
	borderColor?: string;
	groupKey?: string;
	axisX?: number;
	axisY?: number;
	label?: string;
}

// A visual channel. `appliesTo` is a function (not a fixed set) so per-mode
// policy is a one-point control and channels can be added freely.
export interface VisualChannel {
	id: string; // "color" | "size" | ...
	label: string;
	accepts: FieldKind[];
	appliesTo: (mode: ViewMode) => boolean;
	apply: (params: NodeDrawParams, scaled: ScaledValue, ctx: EncContext) => void;
}

// A user-defined binding (persisted in settings.encoding).
export interface EncodingBinding {
	channelId: string;
	fieldId: string;
	scale?: ScaleConfig;
	enabled: boolean;
}
