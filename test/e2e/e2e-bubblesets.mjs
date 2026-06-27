// Self-contained BubbleSets E2E against a dedicated MINIMAL vault.
//
// Mirrors test/e2e/e2e-display.mjs's spawn + raw-CDP client, but targets
// E2E_VAULT (a few files → no inotify exhaustion) on a private user-data-dir
// and a dedicated port (9225, away from 9222/9223/9224). Regenerates the vault
// via setup-e2e-vault.mjs before launching.
//
// PASS conditions:
//   (a) no uncaught page errors / exceptions in the renderer console
//   (b) document.querySelector("canvas") exists with width>0 && height>0
//   (c) app.workspace.layoutReady === true AND the tag-lens view is open
//
// Cleanup: the spawned /tmp-profile Obsidian is killed by process GROUP on exit.
// The user's production Obsidian (different user-data-dir + vault) is untouched.

import { spawn } from "node:child_process";
import fs from "node:fs";
import { E2E_VAULT } from "../config.mjs";
import { setupE2eVault } from "./setup-e2e-vault.mjs";

const PORT = 9225;
const PROFILE = "/tmp/obs-e2e-bubblesets";
const CDP_URL = `http://127.0.0.1:${PORT}`;

// Optional synchronous progress log (TAG_LENS_E2E_DEBUG=/path). Useful when the
// runner buffers/discards stdout: each phase is fsync-flushed immediately so a
// killed run still shows how far it got. No-op unless the env var is set.
const DBG = process.env.TAG_LENS_E2E_DEBUG || "";
const dbg = (m) => { if (DBG) try { fs.appendFileSync(DBG, `${Date.now()} ${m}\n`); } catch {} };
if (DBG) try { fs.writeFileSync(DBG, ""); } catch {}
dbg("module top");

// ── 0. (Re)generate the minimal vault ───────────────────────────────────────
const { vault, changed } = setupE2eVault();
console.log(`[e2e-bubblesets] vault: ${vault} (${changed.length} file(s) (re)written)`);

if (!process.env.DISPLAY) {
	console.error("FAIL: DISPLAY is not set. Run with `DISPLAY=:0 npm run e2e:bubblesets`.");
	process.exit(1);
}

// Pre-flight: Obsidian sets up an inotify file-watcher on vault open. When the
// system's `fs.inotify.max_user_watches` is exhausted (no headroom) that fails
// with ENOSPC, the vault never finishes opening, `layoutReady` never fires and
// the run dies with a confusing "No tab group found" deep inside the plugin.
// Probe for a single free watch up front and fail FAST with the exact fix, so
// the inotify wall is obvious instead of surfacing as a mysterious render error.
try {
	const probeDir = fs.mkdtempSync("/tmp/tl-inotify-probe-");
	const w = fs.watch(probeDir, () => {});
	w.close();
	fs.rmSync(probeDir, { recursive: true, force: true });
} catch (e) {
	if (e && e.code === "ENOSPC") {
		let cur = "?";
		try { cur = fs.readFileSync("/proc/sys/fs/inotify/max_user_watches", "utf8").trim(); } catch {}
		console.error(
			`FAIL: inotify file-watcher limit exhausted (ENOSPC; max_user_watches=${cur}).\n` +
			`Obsidian cannot open the vault without a watcher. Raise the limit and retry:\n` +
			`  sudo sysctl -w fs.inotify.max_user_watches=524288\n` +
			`  # persist: echo 'fs.inotify.max_user_watches=524288' | sudo tee /etc/sysctl.d/99-inotify.conf`,
		);
		process.exit(2);
	}
	// Any other probe error is non-fatal — let the real run surface it.
}

// ── 1. Pre-register the vault (open:true) so a fresh profile opens straight in
//      — otherwise Obsidian stalls on the vault picker / trust prompt. ────────
if (!fs.existsSync(PROFILE)) fs.mkdirSync(PROFILE, { recursive: true });
fs.writeFileSync(
	`${PROFILE}/obsidian.json`,
	JSON.stringify({ vaults: { e2e: { path: E2E_VAULT, ts: 1718270000000, open: true } } }),
);

dbg("before spawn");
const obs = spawn(
	"obsidian",
	[E2E_VAULT, "--user-data-dir=" + PROFILE, "--remote-debugging-port=" + PORT],
	{ detached: true, stdio: "ignore" },
);
dbg("after spawn pid=" + obs.pid);
obs.on("error", (e) => dbg("spawn error: " + e.message));

let cleaned = false;
const cleanup = () => {
	if (cleaned) return;
	cleaned = true;
	try { process.kill(-obs.pid); } catch {}
};
process.on("exit", cleanup);
process.on("SIGINT", () => { cleanup(); process.exit(130); });
process.on("SIGTERM", () => { cleanup(); process.exit(143); });

const die = (msg, code = 1) => { console.error(msg); cleanup(); process.exit(code); };

await new Promise((r) => setTimeout(r, 3000));

// ── 2. Connect to the renderer page target over raw CDP ──────────────────────
let list = null;
for (let i = 0; i < 24; i++) {
	try {
		const res = await fetch(`${CDP_URL}/json/list`);
		if (res.ok) { list = await res.json(); break; }
	} catch {}
	await new Promise((r) => setTimeout(r, 250));
}
dbg("cdp list " + (list ? "ok len=" + list.length : "FAILED"));
if (!list) die("FAIL: CDP /json/list never came up (Obsidian did not start?).");

const page = list.find(
	(t) => t.type === "page" && t.webSocketDebuggerUrl && t.url.startsWith("app://obsidian.md"),
);
if (!page) die("FAIL: no Obsidian renderer page target found.");

dbg("page target found, opening ws");
const ws = new WebSocket(page.webSocketDebuggerUrl);
await new Promise((res, rej) => { ws.onopen = res; ws.onerror = rej; });
dbg("ws open");

let nextId = 1;
const pending = new Map();
const consoleErrors = [];
ws.onmessage = (ev) => {
	const msg = JSON.parse(ev.data);
	if (msg.id && pending.has(msg.id)) { pending.get(msg.id)(msg); pending.delete(msg.id); return; }
	if (msg.method === "Runtime.exceptionThrown") {
		const d = msg.params.exceptionDetails;
		consoleErrors.push(`exception: ${d.exception?.description || d.text}`);
	}
	if (msg.method === "Runtime.consoleAPICalled" && msg.params.type === "error") {
		consoleErrors.push("console.error: " + msg.params.args.map((a) => a.value ?? a.description ?? "").join(" "));
	}
};
const send = (method, params = {}) =>
	new Promise((resolve) => { const id = nextId++; pending.set(id, resolve); ws.send(JSON.stringify({ id, method, params })); });

await send("Runtime.enable");

// ── 3. In-renderer driver: wait for layout → open view → bubblesets → draw ───
const driver = `(async () => {
  const out = { fatal: null, layoutReady: false, viewOpen: false, viewMode: null, canvas: null, laidNodes: 0, memberships: 0 };
  const sleep = (ms) => new Promise(r => setTimeout(r, ms));
  const raf = () => new Promise(r => requestAnimationFrame(r));

  // Wait for the app + plugin host.
  for (let i = 0; i < 60; i++) { if (window.app && window.app.plugins) break; await sleep(250); }
  if (!window.app || !window.app.plugins) { out.fatal = "window.app.plugins never came up"; return out; }

  // Wait for layoutReady (the original failure mode: it never fired).
  await new Promise((res) => {
    if (window.app.workspace.layoutReady) return res();
    window.app.workspace.onLayoutReady(res);
    setTimeout(res, 15000); // don't hang forever; we assert below
  });
  out.layoutReady = !!window.app.workspace.layoutReady;
  if (!out.layoutReady) { out.fatal = "workspace.layoutReady never became true"; return out; }

  // Ensure the plugin is enabled/loaded.
  try {
    window.app.plugins.setEnable(true);
    if (!window.app.plugins.plugins["tag-lens"]) {
      await window.app.plugins.enablePluginAndSave("tag-lens");
    }
  } catch (e) { out.fatal = "enable err: " + e; return out; }

  let plugin = null;
  for (let i = 0; i < 60; i++) { plugin = window.app.plugins.plugins["tag-lens"]; if (plugin) break; await sleep(250); }
  if (!plugin) { out.fatal = "tag-lens plugin did not load"; return out; }

  // Open the view (src/main.ts activateView → registerView VIEW_TYPE_MINI).
  try { await plugin.activateView(); } catch (e) { out.fatal = "activateView threw: " + (e && e.stack || e); return out; }
  await sleep(400);

  const leaf = window.app.workspace.getLeavesOfType("tag-lens-view")[0];
  if (!leaf || !leaf.view) { out.fatal = "no tag-lens-view leaf after activateView"; return out; }
  out.viewOpen = true;
  const view = leaf.view;

  // Force BubbleSets and rebuild + draw.
  try {
    view.settings.viewMode = "bubblesets";
    await view.rebuild();
  } catch (e) { out.fatal = "rebuild threw: " + (e && e.stack || e); return out; }
  out.viewMode = view.settings.viewMode;

  try {
    const ln = (view.laid && view.laid.nodes ? view.laid.nodes : []).filter((n) => !String(n.id).startsWith("\\0"));
    out.laidNodes = ln.length;
    out.memberships = ln.reduce((s, n) => s + ((n.memberships && n.memberships.length) || 0), 0);
  } catch {}

  try { view.draw(); } catch (e) { out.fatal = "draw threw: " + (e && e.stack || e); return out; }

  // Let a few frames settle so the canvas is sized/painted.
  for (let i = 0; i < 8; i++) await raf();
  await sleep(200);

  const c = document.querySelector("canvas");
  if (c) out.canvas = { width: c.width, height: c.height };

  return out;
})()`;

const evaluatePromise = send("Runtime.evaluate", { expression: driver, awaitPromise: true, returnByValue: true });
const timeoutPromise = new Promise((_, rej) => setTimeout(() => rej(new Error("E2E hung (timeout 60s)")), 60000));
let resp;
try {
	resp = await Promise.race([evaluatePromise, timeoutPromise]);
} catch (err) {
	die("FAIL (fatal): " + err.message);
}
if (resp.result?.exceptionDetails) {
	die("FAIL: driver threw: " + JSON.stringify(resp.result.exceptionDetails).slice(0, 800));
}
const report = resp.result.result.value;
dbg("driver returned: " + JSON.stringify(report));
await new Promise((r) => setTimeout(r, 800)); // drain late async console errors

// ── 4. Evaluate PASS conditions ──────────────────────────────────────────────
let failures = 0;
const fail = (m) => { failures++; console.log("  ✗ " + m); };

if (report.fatal) fail("driver fatal: " + report.fatal);

// (c) layoutReady + view open
if (!report.layoutReady) fail("(c) workspace.layoutReady !== true");
if (!report.viewOpen) fail("(c) tag-lens view is not open");
if (report.viewMode !== "bubblesets") fail(`(c) viewMode is "${report.viewMode}", expected "bubblesets"`);

// (b) canvas present and sized
if (!report.canvas) fail("(b) no <canvas> element found");
else if (!(report.canvas.width > 0 && report.canvas.height > 0))
	fail(`(b) canvas not sized: ${report.canvas.width}x${report.canvas.height}`);

// sanity: BubbleSets needs nodes with memberships to actually draw bubbles
if (report.laidNodes <= 0) fail("BubbleSets produced 0 laid nodes (no data?)");
if (report.memberships <= 0) fail("laid nodes carry 0 tag memberships (no clusters → no bubbles)");

// (a) no uncaught page errors / Tag Lens-relevant console errors
if (consoleErrors.length) {
	console.log(`\nconsole errors captured (${consoleErrors.length}):`);
	for (const c of consoleErrors.slice(0, 20)) console.log("  ! " + c.slice(0, 200));
	const relevant = consoleErrors.filter((c) =>
		/tag-lens|MiniGraphView|view\.ts|draw-|bubble|laid|canvas|ENOSPC|No tab group/i.test(c),
	);
	if (relevant.length) { failures += relevant.length; console.log(`  -> ${relevant.length} Tag Lens-relevant (counted as failures)`); }
}

console.log("\nreport:", JSON.stringify(report));
console.log("\n==== BubbleSets E2E: " + (failures === 0 ? "PASS ✅" : `FAIL ✗ (${failures} issue(s))`) + " ====");
ws.close();
cleanup();
process.exit(failures === 0 ? 0 : 1);
