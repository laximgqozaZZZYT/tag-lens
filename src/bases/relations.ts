// Build relations between BaseElements: forward links, shared tags, shared
// frontmatter properties. Pure / Obsidian-free. Cross-base pairs are included
// (the whole point of selecting multiple bases) and flagged via `crossBase`.

import { NONE_BUCKET } from "../types";
import type { BaseElement, BaseRelation, RelationOpts } from "./types";

// Cap on how many element pairs a single grouping value (one tag, or one
// property key=value) may emit, to bound the O(n²) blow-up on a huge shared
// bucket. When a group exceeds GROUP_PAIR_CAP members we still process it but
// the pair count is clamped; the overflow is reported via `warnings`.
const GROUP_SIZE_CAP = 200; // members beyond this in one group are truncated for pairing

export interface BuildRelationsResult {
	relations: BaseRelation[];
	adjacency: Map<string, BaseRelation[]>;
	warnings: string[];
}

export function buildRelations(
	elements: BaseElement[],
	opts: RelationOpts,
): BuildRelationsResult {
	const relations: BaseRelation[] = [];
	const warnings: string[] = [];
	const seen = new Set<string>(); // dedupe: `${kind}|${minKey}|${maxKey}|${via}`

	const byKey = new Map<string, BaseElement>();
	for (const e of elements) byKey.set(e.key, e);

	const add = (rel: BaseRelation): void => {
		const [lo, hi] = rel.aKey <= rel.bKey ? [rel.aKey, rel.bKey] : [rel.bKey, rel.aKey];
		const dedupeKey = `${rel.kind}|${lo}|${hi}|${rel.via}`;
		if (seen.has(dedupeKey)) return;
		seen.add(dedupeKey);
		relations.push(rel);
	};

	if (opts.link) addLinkRelations(elements, byKey, add);
	if (opts.sharedTag) addSharedTagRelations(elements, add, warnings);
	if (opts.sharedProp) addSharedPropRelations(elements, add, warnings);

	const adjacency = new Map<string, BaseRelation[]>();
	for (const rel of relations) {
		pushAdj(adjacency, rel.aKey, rel);
		pushAdj(adjacency, rel.bKey, rel);
	}

	return { relations, adjacency, warnings };
}

function pushAdj(adj: Map<string, BaseRelation[]>, key: string, rel: BaseRelation): void {
	const arr = adj.get(key);
	if (arr) arr.push(rel);
	else adj.set(key, [rel]);
}

function crossBase(a: BaseElement, b: BaseElement): boolean {
	return a.tablePath !== b.tablePath;
}

// --- link: A.note → B.note via a forward link, both ends present as elements ---
function addLinkRelations(
	elements: BaseElement[],
	byKey: Map<string, BaseElement>,
	add: (r: BaseRelation) => void,
): void {
	// note path → element keys at that path (a note may appear in several views).
	const byNote = new Map<string, string[]>();
	for (const e of elements) {
		const arr = byNote.get(e.notePath);
		if (arr) arr.push(e.key);
		else byNote.set(e.notePath, [e.key]);
	}

	for (const a of elements) {
		for (const target of a.links) {
			if (target === a.notePath) continue;
			const targetKeys = byNote.get(target);
			if (!targetKeys) continue;
			for (const bKey of targetKeys) {
				const b = byKey.get(bKey);
				if (!b || b.key === a.key) continue;
				add({
					kind: "link",
					aKey: a.key,
					bKey: b.key,
					aNote: a.notePath,
					bNote: b.notePath,
					via: "link",
					crossBase: crossBase(a, b),
				});
			}
		}
	}
}

// --- shared-tag: elements sharing a tag (NONE_BUCKET / empty excluded) ---
function addSharedTagRelations(
	elements: BaseElement[],
	add: (r: BaseRelation) => void,
	warnings: string[],
): void {
	const groups = new Map<string, BaseElement[]>();
	for (const e of elements) {
		for (const tag of new Set(e.tags)) {
			if (!tag || tag === NONE_BUCKET) continue;
			const arr = groups.get(tag);
			if (arr) arr.push(e);
			else groups.set(tag, [e]);
		}
	}
	emitGroupPairs(groups, "shared-tag", (via) => via, add, warnings);
}

// --- shared-property: elements with identical frontmatter key & value ---
function addSharedPropRelations(
	elements: BaseElement[],
	add: (r: BaseRelation) => void,
	warnings: string[],
): void {
	const groups = new Map<string, BaseElement[]>();
	for (const e of elements) {
		for (const [k, v] of Object.entries(e.fields)) {
			if (v == null || v === "") continue;
			const values = Array.isArray(v) ? v : [v];
			for (const val of values) {
				if (val == null || val === "") continue;
				const gkey = `${k}=${String(val)}`;
				const arr = groups.get(gkey);
				if (arr) arr.push(e);
				else groups.set(gkey, [e]);
			}
		}
	}
	emitGroupPairs(groups, "shared-property", (gkey) => gkey, add, warnings);
}

// Generate all within-group element pairs, capping group size to bound O(n²).
function emitGroupPairs(
	groups: Map<string, BaseElement[]>,
	kind: "shared-tag" | "shared-property",
	via: (groupKey: string) => string,
	add: (r: BaseRelation) => void,
	warnings: string[],
): void {
	for (const [gkey, membersRaw] of groups) {
		// Dedupe elements within the group (a note could land here twice).
		const members = dedupeByKey(membersRaw);
		if (members.length < 2) continue;
		let list = members;
		if (members.length > GROUP_SIZE_CAP) {
			warnings.push(
				`${kind} group "${gkey}" has ${members.length} members; truncated to ${GROUP_SIZE_CAP} for pairing`,
			);
			list = members.slice(0, GROUP_SIZE_CAP);
		}
		const v = via(gkey);
		for (let i = 0; i < list.length; i++) {
			for (let j = i + 1; j < list.length; j++) {
				const a = list[i];
				const b = list[j];
				add({
					kind,
					aKey: a.key,
					bKey: b.key,
					aNote: a.notePath,
					bNote: b.notePath,
					via: v,
					crossBase: crossBase(a, b),
				});
			}
		}
	}
}

function dedupeByKey(els: BaseElement[]): BaseElement[] {
	const seen = new Set<string>();
	const out: BaseElement[] = [];
	for (const e of els) {
		if (seen.has(e.key)) continue;
		seen.add(e.key);
		out.push(e);
	}
	return out;
}
