import { VAULT } from "../config.mjs";
import { spawn } from "node:child_process";
import fs from "node:fs";

// Legend ⇄ Settings vocabulary E2E. Verifies on REAL Obsidian that the on-canvas
// legend's LAYERS & OVERRIDES rows use the SAME terms as the Settings ▸ Encode ▸
// "Layers & Overrides" panel:
//   • "Size R×C"                  (panel: Node display "Size (m × n)")
//   • "N node(s)"                 (panel: cluster header "N nodes")
//   • "Aggregate (3-card stack)"  (panel: Display toggle, when aggregated)
//   • leading "∪ Union" / "∩ Intersection" (panel: set-layer tab titles)
// and that the OLD vocabulary is gone: "card," / "(aggregated)" / "notes".
//
// SAFETY: DEDICATED profile /tmp/obs-e2e-legterms + DEDICATED port 9231 so the
// user's Obsidian (default profile/port) is NEVER touched. Settings mutated are
// deep-snapshotted and restored+saved in a finally; any tag-lens-*.svg created
// is deleted (delta 0).
const DIR = "/tmp/obs-e2e-legterms";
if (!fs.existsSync(DIR)) fs.mkdirSync(DIR, { recursive: true });
fs.writeFileSync(`${DIR}/obsidian.json`, JSON.stringify({ vaults: { dev: { path: VAULT, ts: 1718270000000, open: true } } }));

const obs = spawn("obsidian", [VAULT, "--user-data-dir=" + DIR, "--remote-debugging-port=9231"], { detached: true, stdio: "ignore" });
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
let nextId = 1; const pending = new Map();
ws.onmessage = (ev) => { const msg = JSON.parse(ev.data); if (msg.id && pending.has(msg.id)) { pending.get(msg.id)(msg); pending.delete(msg.id); } };
const send = (method, params = {}) => new Promise((resolve) => { const id = nextId++; pending.set(id, resolve); ws.send(JSON.stringify({ id, method, params })); });
await send("Runtime.enable");

const driver = `(async () => {
  const out = { fatal: null, svg: {}, restored: false, vault: {} };
  const sleep = (ms) => new Promise(r => setTimeout(r, ms));
  for (let i = 0; i < 40; i++) { if (window.app && window.app.plugins) break; await sleep(250); }
  let plugin = null;
  try {
    window.app.plugins.setEnable(true);
    if (!window.app.plugins.plugins["tag-lens"]) await window.app.plugins.enablePluginAndSave("tag-lens");
  } catch(e) { out.fatal = "enable err: " + e; return out; }
  for (let i = 0; i < 40; i++) { plugin = window.app.plugins.plugins["tag-lens"]; if (plugin) break; await sleep(250); }
  if (!plugin) { out.fatal = "plugin not loaded."; return out; }
  await plugin.activateView(); await sleep(300);
  const leaf = window.app.workspace.getLeavesOfType("tag-lens-view")[0];
  if (!leaf || !leaf.view) { out.fatal = "no view leaf"; return out; }
  const view = leaf.view;

  const snap = {
    encoding: JSON.parse(JSON.stringify(view.settings.encoding ?? [])),
    showLegend: view.settings.showLegend,
    viewMode: view.settings.viewMode,
    perspective: view.settings.perspective,
    aggregatedLayers: JSON.parse(JSON.stringify(view.settings.aggregatedLayers ?? [])),
  };

  const exportPaths = () => window.app.vault.getFiles()
    .filter(f => { const n = f.path.split("/").pop(); return n.startsWith("tag-lens-") && (n.endsWith(".svg") || n.endsWith(".png")); })
    .map(f => f.path);
  const beforeSet = new Set(exportPaths());

  const svgFromCaptured = async (captured) => {
    const item = Array.isArray(captured) ? captured[0] : null;
    if (!item || typeof item.getType !== "function") return null;
    const blob = await item.getType("image/svg+xml");
    return blob ? await blob.text() : null;
  };

  let captured = null;
  const origWrite = navigator.clipboard && navigator.clipboard.write;
  const stub = function (data) { captured = data; return Promise.resolve(); };
  let stubbed = false;
  try {
    if (typeof origWrite === "function") {
      Object.defineProperty(navigator.clipboard, "write", { value: stub, configurable: true, writable: true });
      stubbed = true;
    }
    // CLOSEUP + euler (an enclosure mode): the LAYERS & OVERRIDES rows are
    // surfaced as Group enclosure rows + the ∪/∩ addressable layers.
    view.settings.encoding = [];
    view.settings.showLegend = true;
    view.settings.perspective = "closeup";
    view.settings.viewMode = "euler";
    await view.rebuild(); view.draw(); await sleep(40);
    captured = null;
    await view.exportSvg({ fit: false, target: "clipboard" });
    const svg = await svgFromCaptured(captured) || "";
    out.svg.euler = svg;

    // Aggregate the ∪ Union layer, re-export: the row must read
    // "Aggregate (3-card stack)" (panel Display toggle term).
    if (!view.settings.aggregatedLayers.includes("__union__")) view.settings.aggregatedLayers.push("__union__");
    await view.rebuild(); view.draw(); await sleep(40);
    captured = null;
    await view.exportSvg({ fit: false, target: "clipboard" });
    out.svg.eulerAgg = await svgFromCaptured(captured) || "";
  } catch (e) { out.fatal = "render step threw: " + (e && e.stack || e); }
  finally { if (stubbed) Object.defineProperty(navigator.clipboard, "write", { value: origWrite, configurable: true, writable: true }); }

  try {
    view.settings.encoding = snap.encoding;
    view.settings.showLegend = snap.showLegend;
    view.settings.viewMode = snap.viewMode;
    view.settings.perspective = snap.perspective;
    view.settings.aggregatedLayers = snap.aggregatedLayers;
    await view.rebuild(); view.draw(); await view.save();
    out.restored = true;
  } catch (e) { out.restoreErr = "restore threw: " + (e && e.stack || e); }

  try {
    const added = exportPaths().filter(p => !beforeSet.has(p));
    for (const p of added) { const f = window.app.vault.getAbstractFileByPath(p); if (f) await window.app.vault.delete(f); }
    await sleep(80);
    out.vault.delta0 = exportPaths().filter(p => !beforeSet.has(p)).length === 0;
  } catch (e) { out.vault.delta0 = false; }
  return out;
})()`;

const evaluatePromise = send("Runtime.evaluate", { expression: driver, awaitPromise: true, returnByValue: true });
const timeoutPromise = new Promise((_, rej) => setTimeout(() => rej(new Error("E2E Timeout 120s")), 120000));
let resp;
try { resp = await Promise.race([evaluatePromise, timeoutPromise]); }
catch (err) { console.error("FAIL (fatal):", err.message); ws.close(); process.exit(1); }
if (resp.result?.exceptionDetails) { console.error("FAIL: driver threw:", JSON.stringify(resp.result.exceptionDetails).slice(0, 800)); process.exit(1); }
const report = resp.result.result.value;
if (report.fatal) { console.error("FAIL (fatal):", report.fatal); process.exit(1); }

let failures = 0;
console.log("\\n==== Legend ⇄ Settings vocabulary E2E (closeup + euler) ====\\n");

const euler = report.svg.euler || "";
const eulerAgg = report.svg.eulerAgg || "";
// SVG <text> can split runs; collapse to a normalized whitespace string and also
// keep the raw to catch glyphs. We test for the panel terms as substrings.
const check = (svg, label, term, want) => {
  const has = svg.includes(term);
  const ok = has === want;
  console.log("   " + label.padEnd(24) + (want ? "has " : "no  ") + JSON.stringify(term) + " : " + (has ? "yes" : "no") + " -> " + (ok ? "PASS" : "FAIL"));
  if (!ok) failures++;
};

console.log("1) closeup euler legend uses Settings panel terms");
check(euler, "Size R×C present", "Size ", true);
check(euler, "node(s) count present", "node", true);
check(euler, "Union row label", "∪ Union", true);
check(euler, "Intersection row label", "∩ Intersection", true);

console.log("\\n2) OLD vocabulary removed");
check(euler, "no 'card,' suffix", "card,", false);
check(euler, "no '(aggregated)'", "(aggregated)", false);
check(euler, "no 'notes' word", " notes", false);
check(euler, "no 'note,' word", "note,", false);

console.log("\\n3) aggregated ∪ Union row reads 'Aggregate (3-card stack)'");
check(eulerAgg, "Aggregate term", "Aggregate (3-card stack)", true);
check(eulerAgg, "no '(aggregated)'", "(aggregated)", false);

console.log("\\nsvg lengths: euler=" + euler.length + " eulerAgg=" + eulerAgg.length);
console.log("settings restored : " + (report.restored ? "yes" : "NO")); if (!report.restored) failures++;
console.log("vault delta 0     : " + (report.vault.delta0 ? "yes" : "NO")); if (!report.vault.delta0) failures++;
if (report.restoreErr) console.log("restore error: " + report.restoreErr);

console.log("\\n==== result: " + (failures === 0 ? "PASS \\u2705" : "FAIL \\u2717 (" + failures + " issue(s))") + " ====");
ws.close();
process.exit(failures === 0 ? 0 : 1);
