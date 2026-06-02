// Pure (DOM-less) decision logic for the mode-agnostic note navigator.
//
// The navigator (folder tree + search panel, built in view.ts) is shown in
// EVERY view mode. Its two mode-dependent decisions — (1) which note list to
// list, and (2) what a row click should do — are factored out here so they can
// be unit-tested without an Obsidian/DOM environment.

// A note in the navigator. `memberships` are the GROUP_BY group keys the note
// belongs to (one entry per group; hierarchical keys use "/" like "a/b/c").
// Optional/[] when unknown (e.g. a droste gallery cell with no membership data,
// or an aggregate-mode fallback row) — such notes land in the "(untagged)"
// bucket of the tag tree.
export type NoteRef = {
	id: string;
	label: string;
	memberships?: string[];
	// Searchable metadata, populated (in view.ts rebuild) for the visible note
	// set from Obsidian's metadataCache. Optional/undefined for notes built by
	// hand or where the cache was missing — treated as empty by the search.
	//   • path        — the real vault file path (Euler "tag\tpath" prefix stripped).
	//   • tags        — the note's tags (hierarchy kept, leading '#' stripped),
	//                   from memberships + frontmatter tags + inline cache.tags.
	//   • frontmatter — each frontmatter key flattened to an array of string values.
	path?: string;
	tags?: string[];
	frontmatter?: Record<string, string[]>;
};

// Minimal shape of the laid-out view state the navigator cares about. Mirrors
// the relevant fields of the real `Layout` object (see layout.ts) but keeps the
// surface tiny so tests can construct it by hand.
//
// NOTE: `menuNoteList` no longer reads any of these fields for the DISPLAYED
// note set — the list is always the universal `menuNotes` (see below). The
// shape is kept because `menuClickAction` still routes per mode (behaviour,
// not displayed content): droste focuses, positioned nodes locate, the rest
// open the file.
export interface MenuLaidLike {
	// Present (with ≥1 cell) only in droste / Icon Gallery mode.
	drosteGallery?: { cells: NoteRef[] } | null;
	// Positioned cards. Empty in aggregate modes (heatmap/matrix/lattice/upset).
	nodes: { id: string; label: string; memberships?: string[] }[];
}

// The note list to DISPLAY in the navigator. MODE-INVARIANT by construction:
// it is ALWAYS the universal `menuNotes` set (the post-WHERE/HAVING/LIMIT
// visible-note set, captured mode-independently in rebuild() — see view.ts
// `buildMenuNotes`). It does NOT branch on `laid` (no droste-gallery / no
// positioned-`laid.nodes` branch), so switching only the view mode never
// changes the displayed list, the Folder tree, the Tag tree, or search.
//
// `laid` is accepted only for signature stability with `menuClickAction`
// (click ROUTING stays mode-appropriate); it is intentionally unused here.
export function menuNoteList(_laid: MenuLaidLike, menuNotes: NoteRef[]): NoteRef[] {
	return menuNotes.map((n) => ({
		id: n.id,
		label: n.label,
		memberships: n.memberships ?? [],
		path: n.path,
		tags: n.tags,
		frontmatter: n.frontmatter,
	}));
}

// What a row click should do for note `id`, in the current mode:
//   • "drosteFocus" — droste mode: re-centre the gallery on the note.
//   • "locate"      — the note is a positioned on-canvas node: pan/zoom to it.
//   • "openFile"    — aggregate mode / no on-canvas position: open the file.
export type ClickAction = "drosteFocus" | "locate" | "openFile";

export function menuClickAction(laid: MenuLaidLike, id: string): ClickAction {
	const gallery = laid.drosteGallery;
	if (gallery && gallery.cells.length > 0) return "drosteFocus";
	if (laid.nodes.some((n) => n.id === id)) return "locate";
	return "openFile";
}

// ── Note-navigator panel geometry (move + resize) ────────────────────────────
// The navigator panel is mouse-draggable (by its header) and mouse-resizable
// (by a bottom-right corner grab zone). Both interactions funnel through the
// pure `clampRect` below so the math is unit-testable without a DOM.

export interface MenuRect {
	left: number;
	top: number;
	width: number;
	height: number;
}

// Constrain a panel rect to a container.
//   • width/height are floored to `min` and ceilinged to the container size.
//   • left/top are clamped so the panel can't be dragged fully off-screen:
//     at least `keepVisible` px of the panel stays inside on every edge
//     (so the header bar is always grabbable again).
// Pure: no DOM, no mutation of the input.
export function clampRect(
	rect: MenuRect,
	container: { width: number; height: number },
	min: { width: number; height: number },
	keepVisible = 40,
): MenuRect {
	const cw = Math.max(0, container.width);
	const ch = Math.max(0, container.height);
	// Size: never below min, never larger than the container.
	const width = Math.min(Math.max(rect.width, min.width), Math.max(min.width, cw));
	const height = Math.min(Math.max(rect.height, min.height), Math.max(min.height, ch));
	// Position: keep ≥ keepVisible px visible on each axis. The panel's left may
	// range from (keepVisible - width) [almost fully off the left] to
	// (cw - keepVisible) [almost fully off the right].
	const minLeft = keepVisible - width;
	const maxLeft = Math.max(minLeft, cw - keepVisible);
	const minTop = 0; // never above the container (header must stay reachable)
	const maxTop = Math.max(minTop, ch - keepVisible);
	const left = Math.min(Math.max(rect.left, minLeft), maxLeft);
	const top = Math.min(Math.max(rect.top, minTop), maxTop);
	return { left, top, width, height };
}

// ── Note-navigator minimize geometry ─────────────────────────────────────────
// The navigator can be minimized (header double-click): the search box + tree
// body hide and the panel collapses to just the header bar. This pure helper
// picks the panel's effective height for the current minimized state so the
// DOM code (and a unit test) agree on the math:
//   • minimized  → `headerHeight` (header bar only).
//   • restored   → the remembered `restoreHeight` if known, else `currentHeight`
//                  (the live rect height). Floored to `headerHeight` so a
//                  restore can never produce a panel shorter than its header.
// Pure: no DOM, no mutation.
export function noteMenuHeight(
	minimized: boolean,
	headerHeight: number,
	currentHeight: number,
	restoreHeight: number | null,
): number {
	if (minimized) return Math.max(1, headerHeight);
	const target = restoreHeight ?? currentHeight;
	return Math.max(headerHeight, target);
}

// ── Navigator tree model + grouping/search (pure, DOM-less) ──────────────────
// The navigator body renders a collapsible tree. Two groupings are supported:
//   • "folder" — group by the note id path (split on "/"), one leaf per note.
//   • "tag"    — group by each note's membership group keys (also "/"-split for
//                hierarchy). A note with N memberships appears under ALL N
//                groups (duplicate placement is intended). Notes with no
//                memberships go under a deterministic "(untagged)" bucket.
// Both produce the same `TreeNode` shape so the view's renderTree consumes them
// uniformly. Leaves carry the original note id (for the click handler) and a
// display label (the final id path segment).

export interface TreeLeaf {
	id: string;
	label: string;
}

export interface TreeNode {
	folders: Map<string, TreeNode>;
	leaves: TreeLeaf[];
	// Optional display label for THIS folder node, shown by the renderer instead
	// of the parent's Map key. Used by the tag tree so the underlying grouping key
	// (e.g. "tag=project") stays stable while the row reads "#project". When unset
	// the renderer falls back to the Map key (folder tree behaviour, unchanged).
	label?: string;
}

export const UNTAGGED_BUCKET = "(untagged)";

function emptyTree(): TreeNode {
	return { folders: new Map(), leaves: [] };
}

// Strip the Euler-nested-copy prefix from an id.
// Euler/bubbles layout duplicates a note that appears in N intersection regions
// by creating copies with id `${tag}\t${originalPath}`. All other modes use the
// plain file path with no tab. Stripping the prefix lets the folder tree, the
// leaf display label, and the search deduplicator work on the real file path.
export function stripTabPrefix(id: string): string {
	const tab = id.indexOf("\t");
	return tab >= 0 ? id.slice(tab + 1) : id;
}

// ── Per-row graph-visibility checkboxes (pure, DOM-less) ─────────────────────
// Every navigator row (note leaf + folder/tag/combo group) carries a checkbox.
// CHECKED ⇔ the note is VISIBLE on the graph; UNCHECKED ⇔ HIDDEN. The hidden
// state is persisted GLOBALLY per note in `MiniSettings.hiddenNodes` and the
// rebuild/layout/draw pipeline drops hidden notes from the canvas.
//
// The HIDE KEY is the note's real vault PATH (the Euler "tag\tpath" copy prefix
// stripped). Hiding by path — not by the per-copy id — makes a single
// hiddenNodes entry hide EVERY on-canvas representation of the note at once
// (Euler/bubbles place a note as several `${tag}\t${path}` copies). The layout
// and draw filters treat a hiddenNodes entry as a PATH-OR-ID match (see
// `nodeIsHidden`) so both a path entry (our checkboxes) and a raw-id entry (the
// legacy per-cluster "Cards" panel) keep working.

// The persisted hide key for a note: its real path (Euler tab prefix stripped).
export function hideKey(note: NoteRef): string {
	return stripTabPrefix(note.id);
}

// Is an on-canvas node id hidden by `hiddenSet`? Matches either the FULL id
// (legacy per-card entries) OR the note's PATH (our path-keyed checkboxes), so
// that one path entry hides every `${tag}\t${path}` copy of the note in
// Euler/bubbles modes. Pure: no DOM, no mutation.
export function nodeIsHidden(id: string, hiddenSet: Set<string>): boolean {
	return hiddenSet.has(id) || hiddenSet.has(stripTabPrefix(id));
}

// Build the stable path key for a folder node in the navigator tree, given the
// parent's accumulated path prefix and the Map key of the current folder.
// This is the same key stamped as `data-menupath` on folder row elements by the
// navigator DOM builder, and recorded in `noteMenuExpandedPaths` to survive rebuilds.
//
// Rule: if `parentPath` is non-empty, the key is `${parentPath}/${name}`; for a
// top-level folder (empty parent) the key IS `name`.
//
// Exported so the logic is unit-testable independently of the DOM.
export function buildFolderPathKey(parentPath: string, name: string): string {
	return parentPath ? `${parentPath}/${name}` : name;
}

// All DISTINCT descendant note hide-keys under a tree node, recursively across
// nested folders AND combination subgroups. A note that appears under multiple
// groups (e.g. a combo placed under each constituent tag) is counted ONCE.
// Leaf hide-keys are derived from the leaf id via stripTabPrefix so Euler copies
// collapse to their shared path. Deterministic (folders/leaves are walked in the
// tree's already-sorted insertion order); returned de-duplicated, order-stable.
export function collectDescendantNoteKeys(node: TreeNode): string[] {
	const seen = new Set<string>();
	const out: string[] = [];
	const walk = (t: TreeNode): void => {
		for (const lf of t.leaves) {
			const key = stripTabPrefix(lf.id);
			if (!seen.has(key)) { seen.add(key); out.push(key); }
		}
		for (const child of t.folders.values()) walk(child);
	};
	walk(node);
	return out;
}

// Tri-state for a folder/group/combo checkbox from its descendant note keys:
//   • "checked"        — NO descendant is hidden (all visible). Also the state
//                        for an EMPTY group (no descendants) → defaults checked.
//   • "unchecked"      — EVERY descendant is hidden.
//   • "indeterminate"  — a mix of hidden and visible descendants.
// `hiddenSet` is matched by the note PATH key (the keys returned by
// `collectDescendantNoteKeys`). Pure: no DOM, no mutation.
export type FolderCheckState = "checked" | "unchecked" | "indeterminate";
export function folderCheckState(descendantKeys: string[], hiddenSet: Set<string>): FolderCheckState {
	if (descendantKeys.length === 0) return "checked";
	let hidden = 0;
	for (const k of descendantKeys) if (hiddenSet.has(k)) hidden++;
	if (hidden === 0) return "checked";
	if (hidden === descendantKeys.length) return "unchecked";
	return "indeterminate";
}

// Display label for a note: the final segment of its id path (after stripping
// any Euler-copy tab prefix so the label always shows the real filename).
function leafLabel(note: NoteRef): string {
	const path = stripTabPrefix(note.id);
	const parts = path.split("/");
	return parts[parts.length - 1] || path;
}

// Descend/create nested folders for the path segments [0 .. n-2] of `path`
// (the last segment is treated as a sibling list owner by the caller). Returns
// the node the leaf should be pushed into. `path` must have ≥1 segment.
function folderFor(root: TreeNode, path: string[]): TreeNode {
	let cur = root;
	for (let i = 0; i < path.length - 1; i++) {
		const p = path[i];
		let nx = cur.folders.get(p);
		if (!nx) { nx = emptyTree(); cur.folders.set(p, nx); }
		cur = nx;
	}
	return cur;
}

// Recursively sort a tree's folders (by name asc) and leaves (by label asc,
// then id asc for stability). Returns a NEW tree so callers needn't mutate.
function sortedTree(t: TreeNode): TreeNode {
	const out = emptyTree();
	if (t.label !== undefined) out.label = t.label;
	const folderNames = [...t.folders.keys()].sort((a, b) => (a < b ? -1 : a > b ? 1 : 0));
	for (const name of folderNames) {
		out.folders.set(name, sortedTree(t.folders.get(name) as TreeNode));
	}
	out.leaves = [...t.leaves].sort((a, b) =>
		a.label < b.label ? -1 : a.label > b.label ? 1 : (a.id < b.id ? -1 : a.id > b.id ? 1 : 0),
	);
	return out;
}

// Folder tree: group notes by their id path (current/default behaviour). One
// leaf per note. Deterministically sorted.
// Euler-nested-copy ids (`${tag}\t${path}`) are split on the PATH portion only
// (after the tab) so the folder hierarchy reflects the real vault structure
// rather than a corrupted `"tag\tfolder"` first segment.
export function buildFolderTree(notes: NoteRef[]): TreeNode {
	const root = emptyTree();
	for (const n of notes) {
		const path = stripTabPrefix(n.id);
		const parts = path.split("/");
		folderFor(root, parts).leaves.push({ id: n.id, label: parts[parts.length - 1] || path });
	}
	return sortedTree(root);
}

// Tag tree: group notes by their membership group keys. A note with multiple
// memberships is DUPLICATED under each group; hierarchical keys ("a/b/c") nest
// as folders. Notes with no memberships go under UNTAGGED_BUCKET. Deterministic.
export function tagLabel(key: string, display?: string): string {
	const raw = display ?? stripTagPrefix(key);
	const text = raw.startsWith("#") ? raw.slice(1) : raw;
	return `#${text}`;
}

// Strip a leading "tag=" / "tag:" prefix from a group key and URI-decode the
// remainder (membership keys encode the value, e.g. "tag=status%2Factive").
function stripTagPrefix(key: string): string {
	let s = key;
	if (s.startsWith("tag=") || s.startsWith("tag:")) s = s.slice(4);
	try {
		return decodeURIComponent(s);
	} catch {
		return s;
	}
}

// Combination label for a sorted set of membership keys -> "#A · #B · #C".
export function comboLabel(keys: string[], displays?: Map<string, string>): string {
	return keys.map((k) => tagLabel(k, displays?.get(k))).join(" · ");
}

// Tag tree (multi-tag combination structure). Deterministic.
//   - Top level: one folder per DISTINCT membership key, label "#A" (tagLabel).
//   - Under #A: notes with membership EXACTLY {A} -> leaves directly; notes with
//     2+ memberships including A -> COMBINATION SUBGROUP folders keyed by the
//     note's FULL sorted membership set (label "#A · #B …"), duplicated under
//     EVERY constituent tag.
//   - Notes with no memberships -> UNTAGGED_BUCKET top-level folder.
// Sort: tag folders by Map key asc; within a tag renderTree shows folders
// (combos, sorted by "combo:<keys>" asc) before leaves (label asc, id asc).
// `displays` (optional clusterLabels-style key->name map) affects labels only;
// grouping is always by the raw membership keys.
export function buildTagTree(notes: NoteRef[], displays?: Map<string, string>): TreeNode {
	const root = emptyTree();
	const tagFolder = (key: string): TreeNode => {
		let f = root.folders.get(key);
		if (!f) {
			f = emptyTree();
			f.label = key === UNTAGGED_BUCKET ? UNTAGGED_BUCKET : tagLabel(key, displays?.get(key));
			root.folders.set(key, f);
		}
		return f;
	};
	const comboId = (sortedKeys: string[]): string => `combo:${sortedKeys.join("")}`;

	for (const n of notes) {
		const groups = (n.memberships ?? []).filter((g) => g.length > 0);
		if (groups.length === 0) {
			tagFolder(UNTAGGED_BUCKET).leaves.push({ id: n.id, label: leafLabel(n) });
			continue;
		}
		const set = [...new Set(groups)].sort((a, b) => (a < b ? -1 : a > b ? 1 : 0));
		if (set.length === 1) {
			tagFolder(set[0]).leaves.push({ id: n.id, label: leafLabel(n) });
			continue;
		}
		const cid = comboId(set);
		const clabel = comboLabel(set, displays);
		for (const key of set) {
			const parent = tagFolder(key);
			let sub = parent.folders.get(cid);
			if (!sub) {
				sub = emptyTree();
				sub.label = clabel;
				parent.folders.set(cid, sub);
			}
			sub.leaves.push({ id: n.id, label: leafLabel(n) });
		}
	}
	return sortedTree(root);
}


// Flat, UNIQUE-by-path search result. A note matches if the query is a
// substring of its id (or path), its display label, or any of its group
// (membership) names. Each matching note appears EXACTLY ONCE regardless of
// grouping or how many groups it belongs to.
//
// Deduplication uses the PATH key (after stripping any Euler-copy tab prefix)
// so that the same underlying file, which may appear multiple times in the
// note list with different `${tag}\t${path}` ids in Euler/bubbles mode, is
// shown only once in search results. The first occurrence's full id is kept.
//
// Results are sorted (label asc, then path asc) for determinism.
export function searchNotes(notes: NoteRef[], query: string): NoteRef[] {
	const q = query.trim().toLowerCase();
	if (!q) return [];
	const seen = new Set<string>();
	const out: NoteRef[] = [];
	for (const n of notes) {
		const path = stripTabPrefix(n.id);
		if (seen.has(path)) continue;
		const idHit = path.toLowerCase().includes(q) || n.id.toLowerCase().includes(q);
		const labelHit = n.label.toLowerCase().includes(q);
		const groupHit = (n.memberships ?? []).some((g) => g.toLowerCase().includes(q));
		if (idHit || labelHit || groupHit) {
			seen.add(path);
			out.push(n);
		}
	}
	out.sort((a, b) =>
		a.label < b.label ? -1 : a.label > b.label ? 1 : (a.id < b.id ? -1 : a.id > b.id ? 1 : 0),
	);
	return out;
}

// ── ADVANCED search (pure, DOM-less, Obsidian-less) ──────────────────────────
// `advancedSearch(notes, query)` is a richer replacement for `searchNotes` used
// by the navigator's search box. The query is split on whitespace into TERMS;
// ALL terms must match (AND), case-insensitive. Term kinds:
//
//   #tagname    → the note has a tag equal to OR hierarchically under tagname
//                 (prefix match on the tag path: "#proj" matches "proj" and
//                 "proj/alpha", but NOT "project").
//   key:value   → the note's frontmatter[key] has a value CONTAINING value
//                 (substring, case-insensitive). key match is case-insensitive.
//   key:        → (empty value) the note simply HAS that frontmatter key.
//   word        → bare term: substring of the note's label OR path.
//
// A leading "-" NEGATES a term (the note must NOT match it). "-#draft" excludes
// notes tagged #draft; "-status:done" excludes notes whose status contains
// "done"; "-word" excludes notes whose label/path contains word. A lone "-" or
// "-#"/"-key:"-with-nothing degrades to a harmless never/always term (see below).
//
// Returns UNIQUE-by-path notes (Euler "tag\tpath" copies collapse to one; first
// occurrence's id kept), sorted label-asc then path-asc. Empty query → [].

// Resolve the canonical search path for a note: explicit `path` if present
// (set in rebuild), else the id with any Euler tab prefix stripped.
function notePath(n: NoteRef): string {
	return n.path ?? stripTabPrefix(n.id);
}

// Does a single positive term match a note? (Negation is handled by the caller.)
function termMatches(n: NoteRef, term: string): boolean {
	if (term.length === 0) return true; // empty term is a no-op
	// #tag — hierarchical prefix match against the note's tags.
	if (term.startsWith("#")) {
		const want = term.slice(1).toLowerCase();
		if (want.length === 0) return true; // bare "#" matches everything
		const tags = n.tags ?? [];
		return tags.some((t) => {
			const tl = t.toLowerCase();
			return tl === want || tl.startsWith(want + "/");
		});
	}
	// key:value / key: — frontmatter field match.
	const colon = term.indexOf(":");
	if (colon >= 0) {
		const key = term.slice(0, colon).toLowerCase();
		const value = term.slice(colon + 1).toLowerCase();
		const fm = n.frontmatter ?? {};
		// Case-insensitive key lookup.
		const matchKey = Object.keys(fm).find((k) => k.toLowerCase() === key);
		if (matchKey === undefined) return false;
		const vals = fm[matchKey] ?? [];
		if (value.length === 0) return true; // "key:" → presence of the key
		return vals.some((v) => v.toLowerCase().includes(value));
	}
	// bare word — substring of label OR path.
	const w = term.toLowerCase();
	return n.label.toLowerCase().includes(w) || notePath(n).toLowerCase().includes(w);
}

export function advancedSearch(notes: NoteRef[], query: string): NoteRef[] {
	const terms = query.trim().toLowerCase().split(/\s+/).filter((t) => t.length > 0);
	if (terms.length === 0) return [];
	const seen = new Set<string>();
	const out: NoteRef[] = [];
	for (const n of notes) {
		const path = notePath(n);
		if (seen.has(path)) continue;
		let all = true;
		for (const term of terms) {
			const neg = term.startsWith("-");
			const body = neg ? term.slice(1) : term;
			// A lone "-" (empty body) is ignored rather than excluding everything.
			if (neg && body.length === 0) continue;
			const hit = termMatches(n, body);
			if (neg ? hit : !hit) { all = false; break; }
		}
		if (all) {
			seen.add(path);
			out.push(n);
		}
	}
	out.sort((a, b) => {
		const pa = notePath(a), pb = notePath(b);
		return a.label < b.label ? -1 : a.label > b.label ? 1 : (pa < pb ? -1 : pa > pb ? 1 : 0);
	});
	return out;
}

// ── Autocomplete suggestions (pure, DOM-less) ────────────────────────────────
// `suggestQuery(notes, query)` returns completion suggestions for the TOKEN
// currently being typed — the substring after the last whitespace in `query`.
// Each suggestion carries a `kind` so the DOM can style/annotate it and so the
// accept handler knows whether to append a trailing space.
//
//   • token "#par…"   → distinct TAGS (rendered with '#') hierarchically/prefix
//                       matching, kind "tag".
//   • token "key:par…"→ distinct VALUES of that frontmatter key matching par,
//                       rendered "key:value", kind "field".
//   • token "key" (a known frontmatter key, no colon) → "key:" completions too.
//   • bare token      → matching frontmatter KEYS (as "key:", kind "field"),
//                       matching TAGS ("#tag", kind "tag"), and a few matching
//                       note LABELS (kind "note") — merged and capped.
//
// Order is deterministic: by kind priority (tag < field < note) then alpha.
// Empty token → []. Caps: tag/field ~8, merged bare ~10.

export type SuggestKind = "tag" | "field" | "note";
export interface Suggestion {
	text: string;
	kind: SuggestKind;
}

const KIND_RANK: Record<SuggestKind, number> = { tag: 0, field: 1, note: 2 };

function sortSuggestions(list: Suggestion[]): Suggestion[] {
	return [...list].sort((a, b) => {
		const ra = KIND_RANK[a.kind], rb = KIND_RANK[b.kind];
		if (ra !== rb) return ra - rb;
		return a.text < b.text ? -1 : a.text > b.text ? 1 : 0;
	});
}

// The token currently being typed = substring after the last whitespace run.
export function currentToken(query: string): string {
	const m = query.match(/(\S*)$/);
	return m ? m[1] : "";
}

// Distinct sorted tags across the note set (no '#', lowercase preserved as-is).
function allTags(notes: NoteRef[]): string[] {
	const set = new Set<string>();
	for (const n of notes) for (const t of n.tags ?? []) if (t.length > 0) set.add(t);
	return [...set];
}

// Distinct sorted frontmatter keys across the note set.
function allKeys(notes: NoteRef[]): string[] {
	const set = new Set<string>();
	for (const n of notes) for (const k of Object.keys(n.frontmatter ?? {})) if (k.length > 0) set.add(k);
	return [...set];
}

// Distinct values for a given frontmatter key (case-insensitive key match).
function valuesForKey(notes: NoteRef[], key: string): { display: string; value: string }[] {
	const kl = key.toLowerCase();
	const seen = new Set<string>();
	const out: { display: string; value: string }[] = [];
	for (const n of notes) {
		const fm = n.frontmatter ?? {};
		for (const k of Object.keys(fm)) {
			if (k.toLowerCase() !== kl) continue;
			for (const v of fm[k] ?? []) {
				if (seen.has(v)) continue;
				seen.add(v);
				out.push({ display: v, value: v });
			}
		}
	}
	return out;
}

export function suggestQuery(notes: NoteRef[], query: string): Suggestion[] {
	const token = currentToken(query);
	if (token.length === 0) return [];
	const CAP = 8, MERGED_CAP = 10;
	const tl = token.toLowerCase();

	// #tag partial → matching tags.
	if (token.startsWith("#")) {
		const partial = tl.slice(1);
		const out: Suggestion[] = [];
		for (const t of allTags(notes)) {
			if (t.toLowerCase().startsWith(partial)) out.push({ text: `#${t}`, kind: "tag" });
		}
		return sortSuggestions(out).slice(0, CAP);
	}

	// key:partial → matching values of that key (rendered "key:value").
	const colon = token.indexOf(":");
	if (colon >= 0) {
		const key = token.slice(0, colon);
		const partial = token.slice(colon + 1).toLowerCase();
		// Resolve the canonical key casing from the data (first match wins).
		const canonKey = allKeys(notes).find((k) => k.toLowerCase() === key.toLowerCase()) ?? key;
		const out: Suggestion[] = [];
		for (const { value } of valuesForKey(notes, key)) {
			if (value.toLowerCase().includes(partial)) out.push({ text: `${canonKey}:${value}`, kind: "field" });
		}
		return sortSuggestions(out).slice(0, CAP);
	}

	// Bare token → keys (as "key:") + tags ("#tag") + a few note labels.
	const out: Suggestion[] = [];
	// Frontmatter keys whose name matches the token (prefix-then-substring via includes).
	for (const k of allKeys(notes)) {
		if (k.toLowerCase().includes(tl)) out.push({ text: `${k}:`, kind: "field" });
	}
	// Tags whose name matches the token.
	for (const t of allTags(notes)) {
		if (t.toLowerCase().includes(tl)) out.push({ text: `#${t}`, kind: "tag" });
	}
	// A few note labels matching the token.
	const labelSeen = new Set<string>();
	const noteSugs: Suggestion[] = [];
	for (const n of notes) {
		if (n.label.toLowerCase().includes(tl) && !labelSeen.has(n.label)) {
			labelSeen.add(n.label);
			noteSugs.push({ text: n.label, kind: "note" });
		}
	}
	// Cap notes a bit so they don't crowd out tags/fields, then merge + global cap.
	out.push(...noteSugs.slice(0, MERGED_CAP));
	return sortSuggestions(out).slice(0, MERGED_CAP);
}
