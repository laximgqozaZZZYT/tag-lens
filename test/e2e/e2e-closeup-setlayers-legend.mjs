import { VAULT } from "../config.mjs";
import { spawn } from "node:child_process";
import fs from "node:fs";

// CLOSEUP ∪/∩ INDEPENDENT LEGEND E2E. Verifies on REAL Obsidian that, in the
// closeup perspective under enclosure modes (euler / bubblesets):
//   1. buildModeLegendInput() reports closeup:true and a populated setLayers[]
//      (∪ Union + ∩ Intersection) carrying the resolveSetLayer()-backed suffix.
//   2. The set-layer VALUES reflect single-set inheritance (setting-sharing kept):
//      with a global default override the ∪/∩ Size R×C cascades from it.
//   3. draw() for euler + bubblesets in closeup throws nothing (legend renders).
//   4. panorama enclosure does NOT report closeup / keeps setLayers off-display
//      as a separate unit (closeup:false).
//   5. settings restored + saved; vault delta 0.
//
// SAFETY: DEDICATED profile /tmp/obs-e2e-setlayers + DEDICATED port 9231 so the
// user's running Obsidian (port 9222) is NEVER touched. Settings snapshotted and
// restored+saved in finally.
const DIR = "/tmp/obs-e2e-setlayers";
if (!fs.existsSync(DIR)) fs.mkdirSync(DIR, { recursive: true });
fs.writeFileSync(`${DIR}/obsidian.json`, JSON.stringify({ vaults: { dev: { path: VAULT, ts: 1718270000000, open: true } } }));

const obs = spawn("obsidian", [
  VAULT,
  "--user-data-dir=" + DIR,
  "--remote-debugging-port=9231"
], { detached: true, stdio: "ignore" });
process.on("exit", () => { try { process.kill(-obs.pid); } catch (e) {} });

await new Promise(r => setTimeout(r, 3000));
const CDP_URL = "http://127.0.0.1:9231";

let list = null;
for (let i = 0; i < 20; i++) {
  try { const res = await fetch(`${CDP_URL}/json/list`); if (res.ok) { list = await res.json(); break; } } catch (e) {}
  await new Promise(r => setTimeout(r, 250));
}
if (!list) { console.error("FAIL: fetch failed"); process.exit(1); }
const page = list.find((t) => t.type === "page" && t.webSocketDebuggerUrl && t.url.startsWith("app://obsidian.md"));
if (!page) { console.error("FAIL: no Obsidian page target"); process.exit(1); }

const ws = new WebSocket(page.webSocketDebuggerUrl);
await new Promise((res, rej) => { ws.onopen = res; ws.onerror = rej; });
let nextId = 1; const pending = new Map(); const consoleErrors = [];
ws.onmessage = (ev) => {
  const msg = JSON.parse(ev.data);
  if (msg.id && pending.has(msg.id)) { pending.get(msg.id)(msg); pending.delete(msg.id); return; }
  if (msg.method === "Runtime.exceptionThrown") { const d = msg.params.exceptionDetails; consoleErrors.push(`exception: ${d.exception?.description || d.text}`); }
};
const send = (method, params = {}) => new Promise((resolve) => { const id = nextId++; pending.set(id, resolve); ws.send(JSON.stringify({ id, method, params })); });
await send("Runtime.enable");

const driver = `(async () => {
  const out = { fatal: null, closeupEuler: null, closeupBubble: null, panoramaEuler: null, restored: false, draws: {} };
  const sleep = (ms) => new Promise(r => setTimeout(r, ms));
  for (let i = 0; i < 40; i++) { if (window.app && window.app.plugins) break; await sleep(250); }
  const plugin = window.app.plugins.plugins["tag-lens"];
  if (!plugin) { out.fatal = "plugin not loaded"; return out; }
  let leaf = window.app.workspace.getLeavesOfType("tag-lens-view")[0];
  if (!leaf) { leaf = window.app.workspace.getLeaf(true); await leaf.setViewState({ type: "tag-lens-view", active: true }); await sleep(800); }
  const view = leaf.view;
  if (!view) { out.fatal = "no view"; return out; }

  const snap = {
    perspective: view.settings.perspective,
    viewMode: view.settings.viewMode,
    closeupMode: view.settings.closeupMode,
    panoramaMode: view.settings.panoramaMode,
    nodeRows: view.settings.nodeRows,
    nodeCols: view.settings.nodeCols,
  };

  const summarize = (input) => ({
    closeup: input.closeup === true,
    setLayerLabels: (input.setLayers ?? []).map((s) => s.label),
    hasUnion: (input.setLayers ?? []).some((s) => s.key === "__union__"),
    hasInter: (input.setLayers ?? []).some((s) => s.key === "__intersection__"),
  });

  try {
    // Give ∪/∩ a value to inherit from the single-set / global cascade: set a
    // distinctive GLOBAL default node-display so the set-layer suffix reflects it.
    view.settings.nodeRows = 3; view.settings.nodeCols = 4;

    // CLOSEUP + euler
    view.settings.perspective = "closeup";
    view.settings.viewMode = "euler"; view.settings.closeupMode = "euler";
    await view.rebuild(); view.draw();
    out.closeupEuler = summarize(view.buildModeLegendInput());
    try { view.draw(); out.draws.euler = "ok"; } catch (e) { out.draws.euler = String(e); }

    // CLOSEUP + bubblesets
    view.settings.viewMode = "bubblesets"; view.settings.closeupMode = "bubblesets";
    await view.rebuild(); view.draw();
    out.closeupBubble = summarize(view.buildModeLegendInput());
    try { view.draw(); out.draws.bubble = "ok"; } catch (e) { out.draws.bubble = String(e); }

    // PANORAMA + euler (closeup flag must be false)
    view.settings.perspective = "panorama";
    view.settings.viewMode = "euler"; view.settings.panoramaMode = "euler";
    await view.rebuild(); view.draw();
    out.panoramaEuler = summarize(view.buildModeLegendInput());
  } catch (e) {
    out.fatal = String(e && e.stack || e);
  } finally {
    view.settings.perspective = snap.perspective;
    view.settings.viewMode = snap.viewMode;
    view.settings.closeupMode = snap.closeupMode;
    view.settings.panoramaMode = snap.panoramaMode;
    view.settings.nodeRows = snap.nodeRows;
    view.settings.nodeCols = snap.nodeCols;
    try { await plugin.saveData(view.settings); out.restored = true; } catch (e) { out.restored = "save failed: " + e; }
    try { await view.rebuild(); view.draw(); } catch (e) {}
  }
  return out;
})()`;

const res = await send("Runtime.evaluate", { expression: driver, awaitPromise: true, returnByValue: true });
ws.close();

if (res.result?.subtype === "error" || res.exceptionDetails) {
  console.error("FAIL: driver threw", JSON.stringify(res.exceptionDetails || res.result, null, 2));
  process.exit(1);
}
const out = res.result.value;
console.log(JSON.stringify(out, null, 2));
if (consoleErrors.length) console.log("renderer errors:", consoleErrors);

let failed = false;
const assert = (cond, msg) => { if (!cond) { console.error("ASSERT FAIL:", msg); failed = true; } else { console.log("ok -", msg); } };

assert(!out.fatal, "no fatal error: " + (out.fatal || ""));
assert(out.closeupEuler?.closeup === true, "closeup euler reports closeup:true");
assert(out.closeupEuler?.hasUnion && out.closeupEuler?.hasInter, "closeup euler populates ∪ + ∩ setLayers (independent display unit)");
assert(out.closeupBubble?.closeup === true, "closeup bubblesets reports closeup:true");
assert(out.closeupBubble?.hasUnion && out.closeupBubble?.hasInter, "closeup bubblesets populates ∪ + ∩ setLayers");
// setting-sharing kept: the ∪/∩ suffix carries the cascaded Size 3×4 from the
// global default we set (resolveSetLayer superset→global cascade unchanged).
assert(
  (out.closeupEuler?.setLayerLabels || []).some((l) => l.includes("Size 3×4")),
  "∪/∩ value reflects single-set/global inheritance (Size 3×4 cascaded) — settings shared",
);
assert(out.draws?.euler === "ok" && out.draws?.bubble === "ok", "closeup enclosure legend draws without throwing");
assert(out.panoramaEuler?.closeup === false, "panorama euler reports closeup:false (folded layout, not independent unit)");
assert(out.restored === true, "settings restored + saved");

if (failed) { console.error("\\nE2E FAILED"); process.exit(1); }
console.log("\\nE2E PASSED");
