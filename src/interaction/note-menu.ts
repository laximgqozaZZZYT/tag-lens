import { stripTabPrefix } from "../util/tab-prefix";

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

// The note list to DISPLAY in the navigator. It is ALWAYS the `menuNotes` set
// captured in rebuild() and does NOT branch on `laid` here (no droste-gallery /
// no positioned-`laid.nodes` branch). The set itself is chosen upstream by
// `navigatorNodeSource` (see view.ts rebuild): the mode-invariant
// post-WHERE/HAVING/LIMIT set for every mode EXCEPT droste, and the full
// pre-LIMIT gallery snapshot in droste so every Icon Gallery tile is
// controllable. So switching between NON-droste modes never changes the
// displayed list, Folder tree, Tag tree, or search.
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

// Which note set should feed the navigator (and thus which notes get a
// visibility checkbox), given the current mode's on-canvas node universe.
//
// INVARIANT: every node drawn on the canvas MUST have a navigator checkbox,
// otherwise "Deselect all" / per-row unchecking can never hide it.
//
//   • Icon Gallery (droste): the canvas bakes the FULL pre-LIMIT snapshot
//     (`buildGallery` emits one cell per input node), so the navigator must list
//     that SAME full set — not the LIMIT-trimmed menu set. Listing only the
//     trimmed set left LIMIT-dropped gallery tiles with no checkbox, so they
//     could never be hidden (the "deselect-all leaves tiles visible" bug).
//   • every other mode: the canvas draws the mode-invariant LIMIT-trimmed set,
//     so the navigator lists that — keeping the list identical across modes.
//
// Generic over the node shape so callers can pass GraphNode[] or NoteRef[].
// Pure: no DOM, no mutation; returns one of the input arrays as-is.
export function navigatorNodeSource<T>(opts: {
	isDroste: boolean;
	galleryNodes: T[];
	limitedNodes: T[];
}): T[] {
	return opts.isDroste ? opts.galleryNodes : opts.limitedNodes;
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

// Strip the Euler-nested-copy prefix from an id. The canonical definition lives
// in the neutral `util/tab-prefix` module so `draw/` can share it without a
// cross-layer import; re-exported here so the navigator's many call sites (and
// its downstream importers) keep the stable `interaction/note-menu` API.
export { stripTabPrefix };

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

// Bulk Select-all / Deselect-all over the note-menu's current note set: returns
// the NEXT `hiddenNodes` array (pure — no mutation of the input). `hide=true`
// (Deselect all) appends every key not already present, preserving the original
// push order and de-duplicating; `hide=false` (Select all) removes every key.
// Because the per-checkbox path keys are added de-duped, removing all occurrences
// is equivalent to the legacy first-occurrence-per-node splice.
export function bulkSetHidden(current: string[], keys: string[], hide: boolean): string[] {
	if (hide) {
		const out = current.slice();
		for (const k of keys) if (!out.includes(k)) out.push(k);
		return out;
	}
	const remove = new Set(keys);
	return current.filter((k) => !remove.has(k));
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

// Build the navigator folder-row label, prefixing the display text with a
// disclosure triangle that reflects the open/closed state: ▾ (U+25BE) when open,
// ▸ (U+25B8) when closed. Centralises the glyph choice that the tree builder
// repeats for every collapsible row (regular folders and the "(all)" subtree
// header) and at both initial render and each open/close toggle.
//
// Exported so the glyph mapping is unit-testable independently of the DOM.
export function folderToggleLabel(text: string, open: boolean): string {
	return `${open ? "▾" : "▸"} ${text}`;
}

// Disclosure descriptor for a collapsible navigator row: pairs the kids-div
// `display` (open → "block", closed → "none") with the triangle-prefixed label
// from folderToggleLabel. The tree builder inlines this exact pair four times
// (openAll/closeAll for the "(all)" header, openFolder/closeFolder for regular
// folders); centralising it here keeps the block↔open / none↔closed mapping in
// one place (mirrors the noteMenuTopTabDisplay / noteMenuMinimizeDisplay maps).
// The view applies `display` to the kids-div and `label` to the row's label
// span; all event wiring stays in the view.
//
// Exported so the open↔display mapping is unit-testable independently of the DOM.
export function folderDisclosure(text: string, open: boolean): { display: string; label: string } {
	return { display: open ? "block" : "none", label: folderToggleLabel(text, open) };
}

// All DISTINCT descendant note hide-keys under a tree node, recursively across
// nested folders AND combination subgroups. A note that appears under multiple
// groups (e.g. a combo placed under each constituent tag) is counted ONCE.
// Leaf hide-keys are derived from the leaf id via stripTabPrefix so Euler copies
// collapse to their shared path. Deterministic (folders/leaves are walked in the
// tree's already-sorted insertion order); returned de-duplicated, order-stable.
//
// The tag tree is a SHARED DAG (a combo node is referenced under every parent it
// belongs to — see buildTagTree's subset-lattice), so we memoise VISITED NODES
// to avoid re-walking a shared subtree once per path (which would be factorial).
export function collectDescendantNoteKeys(node: TreeNode): string[] {
	const seen = new Set<string>();
	const out: string[] = [];
	const visited = new Set<TreeNode>();
	const walk = (t: TreeNode): void => {
		if (visited.has(t)) return;
		visited.add(t);
		for (const lf of t.leaves) {
			const key = stripTabPrefix(lf.id);
			if (!seen.has(key)) { seen.add(key); out.push(key); }
		}
		for (const child of t.folders.values()) walk(child);
	};
	walk(node);
	return out;
}

// All DISTINCT descendant TreeLeaf objects under a tree node. Same traversal as
// collectDescendantNoteKeys but returns the leaf references themselves (for
// rendering in the navigator's "(all)" subtree). De-duplicated by path
// (stripTabPrefix), sorted label-asc then id-asc. Memoises visited nodes to
// handle the shared-DAG structure safely.
export function collectDescendantLeaves(node: TreeNode): TreeLeaf[] {
	const seen = new Set<string>();
	const out: TreeLeaf[] = [];
	const visited = new Set<TreeNode>();
	const walk = (t: TreeNode): void => {
		if (visited.has(t)) return;
		visited.add(t);
		for (const lf of t.leaves) {
			const key = stripTabPrefix(lf.id);
			if (!seen.has(key)) { seen.add(key); out.push(lf); }
		}
		for (const child of t.folders.values()) walk(child);
	};
	walk(node);
	out.sort((a, b) =>
		a.label < b.label ? -1 : a.label > b.label ? 1 : (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
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

// Cascade decision for a group (folder/tag) checkbox toggle: `true` = hide every
// descendant, `false` = show every descendant. A fully-checked group (all visible)
// hides on toggle; an unchecked OR indeterminate group shows all — so a single
// click always resolves a partial group to fully-visible first. Mirrors the
// standard tri-state "click clears the mixed state toward on" affordance.
export function folderCascadeHide(descendantKeys: string[], hiddenSet: Set<string>): boolean {
	return folderCheckState(descendantKeys, hiddenSet) === "checked";
}

// ARIA `aria-checked` value for a tri-state checkbox. The custom `gim-nav-cb`
// span (leaf + folder rows) carries `data-state` for the CSS glyph and this
// matching `aria-checked` for assistive tech: indeterminate → "mixed", checked
// → "true", unchecked → "false" (the WAI-ARIA tri-state checkbox contract).
export function checkboxAriaChecked(state: FolderCheckState): "mixed" | "true" | "false" {
	if (state === "indeterminate") return "mixed";
	return state === "checked" ? "true" : "false";
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

// Combination label for a sorted set of membership keys -> "#A * #B * #C".
// `*` is the unified AND (intersection) operator across the whole UI; `|` is OR.
export function comboLabel(keys: string[], displays?: Map<string, string>): string {
	return keys.map((k) => tagLabel(k, displays?.get(k))).join(" * ");
}

// Stable Map key for a signature (sorted membership-key set). Space-joined; the
// membership keys are URI-encoded ("tag=foo%20bar"), so they never contain a raw
// space and two different sets cannot collide into one key. A single-tag node
// uses the raw tag key; a combo node's key always contains a space separator.
function sigKey(sortedKeys: string[]): string {
	return sortedKeys.join(" ");
}

// Beyond this signature degree we DON'T materialise the full subset lattice
// (2^k intermediate nodes): such a note is linked straight under its single
// tags instead. Keeps a pathological high-degree note from exploding the tree.
const LATTICE_MAX_DEGREE = 8;

// Sort a SHARED-DAG tree (folders by Map key asc, leaves by label/id asc),
// MEMOISED by node identity so a node referenced under several parents stays a
// single shared object in the output (preventing factorial blow-up).
function sortedTreeShared(root: TreeNode): TreeNode {
	const memo = new Map<TreeNode, TreeNode>();
	const rec = (t: TreeNode): TreeNode => {
		const hit = memo.get(t);
		if (hit) return hit;
		const out = emptyTree();
		memo.set(t, out); // register before recursion so shared children dedupe
		if (t.label !== undefined) out.label = t.label;
		for (const name of [...t.folders.keys()].sort((a, b) => (a < b ? -1 : a > b ? 1 : 0))) {
			out.folders.set(name, rec(t.folders.get(name) as TreeNode));
		}
		out.leaves = [...t.leaves].sort((a, b) =>
			a.label < b.label ? -1 : a.label > b.label ? 1 : (a.id < b.id ? -1 : a.id > b.id ? 1 : 0),
		);
		return out;
	};
	return rec(root);
}

// Tag tree (SUBSET-LATTICE, NESTED). Deterministic.
//   - A note tagged EXACTLY {A,B,C} lands in the node for signature {A,B,C}.
//   - That node is nested under EVERY (k-1)-subset: {A,B,C} -> under {A,B}, {A,C},
//     {B,C}; each {X,Y} -> under single tags {X} and {Y}; single tags are top
//     level. So a combo is reachable along every constituent chain, and the SAME
//     combo node is SHARED (one object) across all its parents -- toggling it in
//     one place updates it everywhere (global per-note hiding + live refresh).
//   - Intermediate subset nodes are created even with no exact-match notes (they
//     host deeper combos); their checkbox reads from descendants (dash if mixed).
//   - Notes with no memberships -> UNTAGGED_BUCKET top-level node.
// Returned as a shared DAG (sortedTreeShared keeps the sharing); renderTree draws
// each occurrence with its own DOM, and collectDescendantNoteKeys de-dupes by
// visited node + note key. `displays` affects labels only.
export function buildTagTree(notes: NoteRef[], displays?: Map<string, string>): TreeNode {
	const root = emptyTree();

	// Exact signature key -> { sig, leaves } (notes tagged EXACTLY that set).
	const exact = new Map<string, { sig: string[]; leaves: TreeLeaf[] }>();
	const untagged: TreeLeaf[] = [];
	for (const n of notes) {
		const groups = (n.memberships ?? []).filter((g) => g.length > 0);
		if (groups.length === 0) { untagged.push({ id: n.id, label: leafLabel(n) }); continue; }
		const sig = [...new Set(groups)].sort((a, b) => (a < b ? -1 : a > b ? 1 : 0));
		const k = sigKey(sig);
		let e = exact.get(k);
		if (!e) { e = { sig, leaves: [] }; exact.set(k, e); }
		e.leaves.push({ id: n.id, label: leafLabel(n) });
	}

	// One SHARED node per relevant signature (subsets of note signatures).
	const nodes = new Map<string, { sig: string[]; node: TreeNode }>();
	const ensureNode = (sig: string[]): TreeNode => {
		const k = sigKey(sig);
		let r = nodes.get(k);
		if (!r) {
			const node = emptyTree();
			node.label = sig.length === 1 ? tagLabel(sig[0], displays?.get(sig[0])) : comboLabel(sig, displays);
			r = { sig, node };
			nodes.set(k, r);
		}
		return r.node;
	};
	// Every non-empty subset of a sorted signature (each subset stays sorted).
	const subsetsOf = (sig: string[]): string[][] => {
		const res: string[][] = [];
		for (let mask = 1; mask < (1 << sig.length); mask++) {
			const sub: string[] = [];
			for (let i = 0; i < sig.length; i++) if (mask & (1 << i)) sub.push(sig[i]);
			res.push(sub);
		}
		return res;
	};

	// Materialise nodes: always the single tags; the full lattice up to the cap;
	// the exact signature node itself (carrying the leaves).
	for (const { sig, leaves } of exact.values()) {
		for (const t of sig) ensureNode([t]);
		if (sig.length <= LATTICE_MAX_DEGREE) {
			for (const sub of subsetsOf(sig)) ensureNode(sub);
		}
		ensureNode(sig).leaves.push(...leaves);
	}

	// Wire parent -> child by the Hasse (immediate-subset) relation. A size-1 node
	// is top level. A size-k node nests under each existing (k-1)-subset; if none
	// exist (a capped high-degree note), it falls back under its single tags.
	for (const { sig, node } of nodes.values()) {
		if (sig.length === 1) { root.folders.set(sigKey(sig), node); continue; }
		const parents: string[][] = [];
		for (let i = 0; i < sig.length; i++) {
			const parentSig = sig.slice(0, i).concat(sig.slice(i + 1));
			if (nodes.has(sigKey(parentSig))) parents.push(parentSig);
		}
		const targets = parents.length > 0 ? parents : sig.map((t) => [t]);
		for (const p of targets) nodes.get(sigKey(p))!.node.folders.set(sigKey(sig), node);
	}

	if (untagged.length > 0) {
		const u = emptyTree();
		u.label = UNTAGGED_BUCKET;
		u.leaves.push(...untagged);
		root.folders.set(UNTAGGED_BUCKET, u);
	}

	return sortedTreeShared(root);
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

type SuggestKind = "tag" | "field" | "note";
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

// Replace the token currently being typed (the trailing non-space run) with the
// accepted suggestion `text`, returning the new full search value. Tags/notes get
// a trailing space (the term is complete); a "key:" completion keeps no space so
// the user can continue typing the value. Pure: never touches the DOM.
export function applySuggestionToken(value: string, text: string): string {
	const tok = currentToken(value);
	const head = value.slice(0, value.length - tok.length);
	const trailing = text.endsWith(":") ? "" : " ";
	return head + text + trailing;
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

// ── Suggestion-dropdown keyboard reducer ────────────────────────────────────
// Pure transition for the search box's keydown handler. Given the current
// dropdown state and the pressed key, return the action the view should take
// (open / move the highlight / accept / run the search / close), along with
// which default event behaviours to suppress. `selIdx` is the keyboard-
// highlighted row (−1 = none); `count` is the number of live suggestions;
// `open` mirrors whether the dropdown is currently shown WITH suggestions
// (so `open` implies `count > 0`, keeping the modulo math safe).
export interface SuggestKeyState {
	open: boolean;
	selIdx: number;
	count: number;
}

export type SuggestKeyAction =
	| { type: "none" }
	| { type: "open" }
	| { type: "move"; selIdx: number; preventDefault: true }
	| { type: "accept"; index: number; preventDefault: true }
	| { type: "search" }
	| { type: "close"; preventDefault: true; stopPropagation: true };

export function suggestKeyAction(key: string, state: SuggestKeyState): SuggestKeyAction {
	const { open, selIdx, count } = state;
	switch (key) {
		case "ArrowDown":
			if (!open) return { type: "open" };
			return { type: "move", selIdx: (selIdx + 1) % count, preventDefault: true };
		case "ArrowUp":
			if (!open) return { type: "none" };
			return { type: "move", selIdx: (selIdx - 1 + count) % count, preventDefault: true };
		case "Enter":
			if (open && selIdx >= 0) return { type: "accept", index: selIdx, preventDefault: true };
			return { type: "search" };
		case "Escape":
			if (open) return { type: "close", preventDefault: true, stopPropagation: true };
			return { type: "none" };
		default:
			return { type: "none" };
	}
}
