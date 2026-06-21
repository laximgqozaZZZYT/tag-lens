// DataviewJS (dvjs) filter mode tests.
//
// Covers the two-path design after the DQL-delegation fix:
//  1. collectPathsDeep — recursive, cycle-safe, depth-limited path extraction
//     from an arbitrary Dataview QueryResult value.
//  2. runDvjsDqlFilter — DQL is delegated WHOLE to Dataview's `api.query()`
//     (so WHERE/SORT/GROUP BY are honoured); success → deep-scanned paths,
//     failure → formatted error, missing engine → fallback signal.
//  3. buildGraph JS path — `new Function` script behaviour is UNCHANGED (the
//     JS branch never touches api.query).
import { ok } from "./assert";
import { collectPathsDeep, runDvjsDqlFilter, buildGraph } from "../src/query/parser";

// ── Minimal duck-typed App ────────────────────────────────────────────────
// Builds an app whose Dataview api.query returns `queryValue` (or throws/fails
// per opts). getMarkdownFiles + metadataCache are stubbed enough for buildGraph.
interface FileStub {
	path: string;
	basename: string;
	stat: { ctime: number; mtime: number; size: number };
}
function fileStub(path: string): FileStub {
	const basename = path.replace(/\.md$/, "").split("/").pop() ?? path;
	return { path, basename, stat: { ctime: Date.now(), mtime: Date.now(), size: 100 } };
}

function makeApp(opts: {
	paths: string[];
	dvApi?: unknown; // override the dataview api object (undefined = no plugin)
	noPlugin?: boolean;
}): any {
	const files = opts.paths.map(fileStub);
	const plugins = opts.noPlugin
		? {}
		: { dataview: { api: opts.dvApi } };
	return {
		plugins: { plugins },
		vault: { getMarkdownFiles: () => files },
		metadataCache: {
			resolvedLinks: {},
			getFileCache: () => null,
			getFirstLinkpathDest: (link: string) => {
				const hit = files.find((f) => f.path === link || f.basename === link);
				return hit ? { path: hit.path } : null;
			},
		},
	};
}

const ALL = new Set(["a.md", "b.md", "c.md"]);
const app = makeApp({ paths: [...ALL] });

// ── collectPathsDeep ──────────────────────────────────────────────────────

// Flat array of {path} objects.
{
	const out = collectPathsDeep([{ path: "a.md" }, { path: "b.md" }], ALL, app);
	ok(out.has("a.md") && out.has("b.md") && out.size === 2, "collectPathsDeep flat array of pages");
}

// Nested structure: {rows:[{file:{path}}]} (TABLE-like value shape).
{
	const value = { rows: [{ file: { path: "a.md" } }, { file: { path: "c.md" } }] };
	const out = collectPathsDeep(value, ALL, app);
	ok(out.has("a.md") && out.has("c.md") && out.size === 2, "collectPathsDeep nested {file:{path}}");
}

// Plain string paths inside arrays.
{
	const out = collectPathsDeep(["a.md", ["b.md"]], ALL, app);
	ok(out.has("a.md") && out.has("b.md"), "collectPathsDeep nested string arrays");
}

// Paths NOT in the vault are dropped (resolveToVaultPath fails).
{
	const out = collectPathsDeep([{ path: "ghost.md" }], ALL, app);
	ok(out.size === 0, "collectPathsDeep drops unknown paths");
}

// Cycle safety: a self-referential object must not loop forever.
{
	const node: any = { path: "a.md" };
	node.self = node;
	node.kids = [node];
	const out = collectPathsDeep(node, ALL, app);
	ok(out.has("a.md") && out.size === 1, "collectPathsDeep survives reference cycle");
}

// Depth limit: a path buried deeper than depthLimit is not collected.
{
	// Build nesting: {x:{x:{x:{x:{x:{x:{x:{path:'a.md'}}}}}}}} (8 deep)
	let deep: any = { path: "a.md" };
	for (let i = 0; i < 8; i++) deep = { x: deep };
	const shallow = collectPathsDeep(deep, ALL, app, 3);
	ok(shallow.size === 0, "collectPathsDeep honours depthLimit (too deep → 0)");
	const full = collectPathsDeep(deep, ALL, app, 20);
	ok(full.has("a.md"), "collectPathsDeep finds path within a generous depth");
}

// ── runDvjsDqlFilter (DQL delegation) ─────────────────────────────────────

// Non-DQL (JS) script → returns null so the caller uses the synchronous JS path.
await (async () => {
	const r = await runDvjsDqlFilter(app, "return dv.pages('#x').map(p=>p.file.path)", ALL);
	ok(r.matchedPaths === null && !r.error, "runDvjsDqlFilter returns null for JS scripts");
})();

// Empty script → null, no error.
await (async () => {
	const r = await runDvjsDqlFilter(app, "   ", ALL);
	ok(r.matchedPaths === null && !r.error, "runDvjsDqlFilter null on empty script");
})();

// DQL success: api.query returns a WHERE-filtered subset → deep-scanned paths.
await (async () => {
	let receivedSource = "";
	const dvApi = {
		pages: () => [],
		query: async (source: string) => {
			receivedSource = source;
			// Simulate WHERE having filtered to just a.md + c.md.
			return { successful: true, value: { values: [{ path: "a.md" }, { path: "c.md" }] } };
		},
	};
	const a = makeApp({ paths: [...ALL], dvApi });
	const script = "LIST FROM #tag WHERE file.name != \"b\"";
	const r = await runDvjsDqlFilter(a, script, ALL);
	ok(receivedSource === script, "runDvjsDqlFilter passes FULL DQL text (not just FROM) to api.query");
	ok(r.matchedPaths !== null && r.matchedPaths.has("a.md") && r.matchedPaths.has("c.md"), "DQL success extracts WHERE-filtered paths");
	ok(r.matchedPaths !== null && !r.matchedPaths.has("b.md"), "DQL WHERE exclusion is respected");
})();

// DQL failure: api.query resolves successful=false → formatted error.
await (async () => {
	const dvApi = { pages: () => [], query: async () => ({ successful: false, error: "bad WHERE" }) };
	const a = makeApp({ paths: [...ALL], dvApi });
	const r = await runDvjsDqlFilter(a, "LIST FROM #tag WHERE", ALL);
	ok(r.error === "Dataviewjs error: bad WHERE", "DQL failure formats the engine error");
	ok(r.matchedPaths !== null && r.matchedPaths.size === 0, "DQL failure yields empty (non-null) set");
})();

// DQL throw: api.query rejects → formatted error.
await (async () => {
	const dvApi = { pages: () => [], query: async () => { throw new Error("boom"); } };
	const a = makeApp({ paths: [...ALL], dvApi });
	const r = await runDvjsDqlFilter(a, "TABLE foo FROM #t", ALL);
	ok(r.error === "Dataviewjs error: boom", "DQL throw formats the thrown error");
})();

// No Dataview plugin → fallback signal (null + unavailable error).
await (async () => {
	const a = makeApp({ paths: [...ALL], noPlugin: true });
	const r = await runDvjsDqlFilter(a, "LIST FROM #t", ALL);
	ok(r.matchedPaths === null && r.error === "Dataview plugin is not available.", "no plugin → unavailable fallback");
})();

// Plugin present but api lacks query() → unavailable fallback (don't mis-evaluate).
await (async () => {
	const a = makeApp({ paths: [...ALL], dvApi: { pages: () => [] } });
	const r = await runDvjsDqlFilter(a, "LIST FROM #t", ALL);
	ok(r.matchedPaths === null && r.error === "Dataview plugin is not available.", "no api.query → unavailable fallback");
})();

// ── buildGraph JS path unchanged ──────────────────────────────────────────

// A JS script returning a path array selects exactly those notes as Core.
{
	const dvApi = {
		pages: () => [{ file: { path: "a.md" } }, { file: { path: "b.md" } }, { file: { path: "c.md" } }],
		// query exists but must NOT be used for the JS path.
		query: async () => { throw new Error("query must not be called for JS"); },
	};
	const a = makeApp({ paths: [...ALL], dvApi });
	const { result } = buildGraph(
		a,
		[],
		[],
		"dvjs",
		"return ['a.md','c.md']",
		undefined,
		false,
		// dvjsResolved null → buildGraph runs the synchronous JS path.
		{ matchedPaths: null },
	);
	const ids = new Set(result.data.nodes.map((n) => n.id));
	ok(ids.has("a.md") && ids.has("c.md") && !ids.has("b.md"), "buildGraph JS path selects returned paths (unchanged)");
}

// buildGraph with a pre-resolved DQL set uses it directly.
{
	const a = makeApp({ paths: [...ALL], dvApi: { pages: () => [] } });
	const { result } = buildGraph(
		a,
		[],
		[],
		"dvjs",
		"LIST FROM #t",
		undefined,
		false,
		{ matchedPaths: new Set(["b.md"]) },
	);
	const ids = new Set(result.data.nodes.map((n) => n.id));
	ok(ids.has("b.md") && !ids.has("a.md") && !ids.has("c.md"), "buildGraph uses pre-resolved DQL matchedPaths");
}

// buildGraph dvjs with DQL-unavailable error falls back to SQL pipeline (WHERE).
{
	const a = makeApp({ paths: [...ALL], dvApi: { pages: () => [] } });
	const { errors } = buildGraph(
		a,
		[],
		[],
		"dvjs",
		"LIST FROM #t",
		undefined,
		false,
		{ matchedPaths: null, error: "Dataview plugin is not available." },
	);
	ok(errors.where === "Dataview plugin is not available.", "buildGraph surfaces DQL-unavailable error for the banner");
}
