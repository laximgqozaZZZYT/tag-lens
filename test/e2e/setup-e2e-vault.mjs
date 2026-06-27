// Idempotently (re)generate a MINIMAL Obsidian vault dedicated to Tag Lens E2E.
//
// WHY a dedicated tiny vault?
//   The real dev vault (343 dirs) exhausts the system inotify watch budget
//   (fs.inotify.max_user_watches). A fresh Obsidian profile tries to install a
//   recursive file watcher for every dir → ENOSPC → vault.open() stalls →
//   workspace.layoutReady never fires → activateView() throws "No tab group
//   found". A vault with a handful of files needs only a few watchers, so the
//   harness runs even with a near-exhausted inotify budget AND never touches
//   the user's running production Obsidian (separate vault + user-data-dir).
//
// The vault is built so Tag Lens BubbleSets has interesting structure to draw:
//   every note carries #timeline, and #beat/#scene/#sequence/#drama are layered
//   so the tag-clusters overlap, nest, and partly exclude one another.
//
// Layout of <E2E_VAULT>:
//   *.md                         8 tagged notes (frontmatter tags)
//   _all.base                    pre-seeded fallback base (one view per tag)
//   .obsidian/app.json           {}
//   .obsidian/core-plugins.json  minimal core plugins
//   .obsidian/community-plugins.json  ["tag-lens"]
//   .obsidian/workspace.json     valid root split + one tab group (layoutReady)
//   .obsidian/plugins/tag-lens/{main.js,manifest.json,styles.css,data.json}
//
// Run standalone:  node test/e2e/setup-e2e-vault.mjs

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { E2E_VAULT } from "../config.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, "..", "..");

function writeIfChanged(p, content) {
	try {
		if (fs.existsSync(p) && fs.readFileSync(p, "utf8") === content) return false;
	} catch {}
	fs.mkdirSync(path.dirname(p), { recursive: true });
	fs.writeFileSync(p, content);
	return true;
}

function copyIfChanged(src, dst) {
	const content = fs.readFileSync(src);
	try {
		if (fs.existsSync(dst) && Buffer.compare(fs.readFileSync(dst), content) === 0) return false;
	} catch {}
	fs.mkdirSync(path.dirname(dst), { recursive: true });
	fs.writeFileSync(dst, content);
	return true;
}

// ── 1. The 8 tagged notes ───────────────────────────────────────────────────
// Tag plan (every note has #timeline → the universe set):
//   beat:     n1 n2 n3 n4        (large cluster)
//   scene:    n3 n4 n5 n6        (overlaps beat on n3,n4)
//   sequence: n4                 (single note ⊂ beat ∩ scene → nesting)
//   drama:    n7 n8              (disjoint from beat/scene → exclusion)
// This mixes overlap (beat∩scene), containment (sequence⊂beat,scene) and
// exclusion (drama vs beat/scene), exactly what BubbleSets is meant to show.
const NOTES = [
	{ name: "n1-opening.md",   tags: ["timeline", "beat"] },
	{ name: "n2-rising.md",    tags: ["timeline", "beat"] },
	{ name: "n3-turn.md",      tags: ["timeline", "beat", "scene"] },
	{ name: "n4-midpoint.md",  tags: ["timeline", "beat", "scene", "sequence"] },
	{ name: "n5-fall.md",      tags: ["timeline", "scene"] },
	{ name: "n6-crisis.md",    tags: ["timeline", "scene"] },
	{ name: "n7-coda.md",      tags: ["timeline", "drama"] },
	{ name: "n8-finale.md",    tags: ["timeline", "drama"] },
];

function noteBody(name, tags) {
	const title = name.replace(/\.md$/, "");
	return [
		"---",
		"tags:",
		...tags.map((t) => `  - ${t}`),
		"---",
		"",
		`# ${title}`,
		"",
		`A tiny E2E note tagged ${tags.map((t) => "#" + t).join(" ")}.`,
		"",
	].join("\n");
}

// ── 2. Pre-seeded fallback base (one table view per tag) ─────────────────────
// Mirrors src/bases/fallback.ts buildFallbackContent(): one view per tag,
// filtering file.tags.contains("#<tag>"). Pre-seeding it (instead of letting
// the plugin auto-create _all.base on first rebuild) makes the run
// deterministic and avoids a vault-write race during the E2E.
const TAG_VIEWS = ["timeline", "beat", "scene", "sequence", "drama"];
function buildBase() {
	const lines = ["views:"];
	for (const tag of TAG_VIEWS) {
		lines.push("  - type: table");
		lines.push(`    name: "${tag}"`);
		lines.push(`    filters: "file.tags.contains(\\"#${tag}\\")"`);
		lines.push("    order:");
		lines.push("      - file.name");
	}
	return lines.join("\n") + "\n";
}

// ── 3. .obsidian config ──────────────────────────────────────────────────────
const APP_JSON = "{}\n";
// Minimal core plugins — only what a headless vault needs. file-explorer +
// workspaces keep the workspace.json layout valid; the rest are intentionally
// absent so no extra watchers / panes spin up.
const CORE_PLUGINS = JSON.stringify(
	{
		"file-explorer": true,
		"global-search": false,
		"switcher": false,
		"graph": false,
		"backlink": false,
		"canvas": false,
		"outgoing-link": false,
		"tag-pane": false,
		"properties": false,
		"page-preview": false,
		"daily-notes": false,
		"templates": false,
		"note-composer": false,
		"command-palette": true,
		"editor-status": false,
		"bookmarks": false,
		"markdown-importer": false,
		"zk-prefixer": false,
		"random-note": false,
		"outline": false,
		"word-count": false,
		"slides": false,
		"audio-recorder": false,
		"workspaces": false,
		"file-recovery": false,
		"publish": false,
		"sync": false,
		"bases": true,
	},
	null,
	2,
) + "\n";

const COMMUNITY_PLUGINS = JSON.stringify(["tag-lens"], null, 2) + "\n";

// A valid workspace: root split holding ONE tabs group with the first note
// open. The presence of a real rootSplit + tab group is what makes
// workspace.layoutReady fire and getLeaf("tab") succeed (the original failure
// was "No tab group found." because rootSplit was null).
function buildWorkspace() {
	return JSON.stringify(
		{
			main: {
				id: "root-split",
				type: "split",
				children: [
					{
						id: "tab-group-1",
						type: "tabs",
						children: [
							{
								id: "leaf-1",
								type: "leaf",
								state: {
									type: "markdown",
									state: { file: NOTES[0].name, mode: "source", source: false },
								},
							},
						],
					},
				],
				direction: "vertical",
			},
			left: {
				id: "left-split",
				type: "split",
				children: [
					{
						id: "left-tabs",
						type: "tabs",
						children: [
							{
								id: "fe-leaf",
								type: "leaf",
								state: { type: "file-explorer", state: {} },
							},
						],
					},
				],
				direction: "horizontal",
				width: 200,
				collapsed: true,
			},
			right: {
				id: "right-split",
				type: "split",
				children: [
					{
						id: "right-tabs",
						type: "tabs",
						children: [
							{
								id: "right-leaf",
								type: "leaf",
								state: { type: "empty", state: {} },
							},
						],
					},
				],
				direction: "horizontal",
				width: 300,
				collapsed: true,
			},
			active: "leaf-1",
			lastOpenFiles: NOTES.map((n) => n.name),
		},
		null,
		2,
	) + "\n";
}

// ── 4. Plugin install + data.json (open straight into BubbleSets) ────────────
// Field names verified against src/types.ts DEFAULT_SETTINGS:
//   viewMode: ViewMode   ("bubblesets")
//   selectedBases: string[]  (pre-seed the fallback base path)
const PLUGIN_DATA = JSON.stringify(
	{ viewMode: "bubblesets", selectedBases: ["_all.base"] },
	null,
	2,
) + "\n";

export function setupE2eVault() {
	const vault = E2E_VAULT;
	const ob = path.join(vault, ".obsidian");
	const pluginDir = path.join(ob, "plugins", "tag-lens");

	const changed = [];

	for (const n of NOTES) {
		if (writeIfChanged(path.join(vault, n.name), noteBody(n.name, n.tags))) changed.push(n.name);
	}
	if (writeIfChanged(path.join(vault, "_all.base"), buildBase())) changed.push("_all.base");

	if (writeIfChanged(path.join(ob, "app.json"), APP_JSON)) changed.push(".obsidian/app.json");
	if (writeIfChanged(path.join(ob, "core-plugins.json"), CORE_PLUGINS)) changed.push(".obsidian/core-plugins.json");
	if (writeIfChanged(path.join(ob, "community-plugins.json"), COMMUNITY_PLUGINS)) changed.push(".obsidian/community-plugins.json");
	if (writeIfChanged(path.join(ob, "workspace.json"), buildWorkspace())) changed.push(".obsidian/workspace.json");

	// Built plugin artifacts from the repo root (run `npm run build` first).
	for (const f of ["main.js", "manifest.json", "styles.css"]) {
		const src = path.join(REPO_ROOT, f);
		if (!fs.existsSync(src)) {
			throw new Error(`Missing build artifact ${src}. Run \`npm run build\` before the E2E.`);
		}
		if (copyIfChanged(src, path.join(pluginDir, f))) changed.push(`plugins/tag-lens/${f}`);
	}
	if (writeIfChanged(path.join(pluginDir, "data.json"), PLUGIN_DATA)) changed.push("plugins/tag-lens/data.json");

	return { vault, changed };
}

// Run directly: `node test/e2e/setup-e2e-vault.mjs`
if (import.meta.url === `file://${process.argv[1]}`) {
	const { vault, changed } = setupE2eVault();
	console.log(`[setup-e2e-vault] vault: ${vault}`);
	if (changed.length === 0) console.log("[setup-e2e-vault] up to date (no changes).");
	else { console.log(`[setup-e2e-vault] wrote ${changed.length} file(s):`); for (const c of changed) console.log("  + " + c); }
}
