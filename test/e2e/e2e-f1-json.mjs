import { VAULT } from "../config.mjs";
import { spawn } from "node:child_process";
import fs from "node:fs";

// F1 (preset JSON import/export + Data ▸ JSON tab) E2E. Mirrors e2e-display.mjs:
// SEPARATE profile + SEPARATE port so the user's running Obsidian (profile
// ~/.config/obsidian, port 9222) is never touched. We pre-register the dev vault
// (open:true) in this fresh profile so Obsidian boots straight into it.
const DIR = "/tmp/obs-e2e-f1json";
if (!fs.existsSync(DIR)) fs.mkdirSync(DIR, { recursive: true });
fs.writeFileSync(`${DIR}/obsidian.json`, JSON.stringify({ vaults: { dev: { path: VAULT, ts: 1718270000000, open: true } } }));

const obs = spawn("obsidian", [
  VAULT,
  "--user-data-dir=" + DIR,
  "--remote-debugging-port=9226"
], { detached: true, stdio: "ignore" });

// Kill the detached Obsidian process GROUP on exit so the instance never leaks
// (it holds port 9226 and blocks the next run otherwise).
process.on("exit", () => { try { process.kill(-obs.pid); } catch (e) {} });

await new Promise(r => setTimeout(r, 3000));

const CDP_URL = "http://127.0.0.1:9226";

let list = null;
for (let i = 0; i < 20; i++) {
  try {
    const res = await fetch(`${CDP_URL}/json/list`);
    if (res.ok) { list = await res.json(); break; }
  } catch (e) {}
  await new Promise(r => setTimeout(r, 250));
}
if (!list) { console.error("FAIL: fetch failed"); process.exit(1); }

const page = list.find((t) => t.type === "page" && t.webSocketDebuggerUrl && t.url.startsWith("app://obsidian.md"));
if (!page) { console.error("FAIL: no Obsidian page target"); process.exit(1); }

const ws = new WebSocket(page.webSocketDebuggerUrl);
await new Promise((res, rej) => { ws.onopen = res; ws.onerror = rej; });

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

// ---- in-renderer driver: exercise F1 JSON tab, collect a structured report ----
// SAFETY: snapshots lensPresets + encoding up front, restores them in a finally
// block (Import / Load-bundled call view.save() and persist to the dev vault's
// data.json — we must leave no trace).
const driver = `(async () => {
  const out = { fatal: null, checks: {}, snapPresetCount: 0, finalPresetCount: 0, restored: false };
  const sleep = (ms) => new Promise(r => setTimeout(r, ms));
  const has = (s, sub) => typeof s === "string" && s.indexOf(sub) >= 0;

  for (let i = 0; i < 40; i++) { if (window.app && window.app.plugins) break; await sleep(250); }

  let plugin = null;
  try {
    window.app.plugins.setEnable(true);
    if (!window.app.plugins.plugins["tag-lens"]) {
      await window.app.plugins.enablePluginAndSave("tag-lens");
    }
  } catch(e) { out.fatal = "enable err: " + e; return out; }
  for (let i = 0; i < 40; i++) { plugin = window.app.plugins.plugins["tag-lens"]; if (plugin) break; await sleep(250); }
  if (!plugin) { out.fatal = "plugin not loaded."; return out; }
  await plugin.activateView(); await sleep(300);
  const leaf = window.app.workspace.getLeavesOfType("tag-lens-view")[0];
  if (!leaf || !leaf.view) { out.fatal = "no view leaf"; return out; }
  const view = leaf.view;

  // ── SAFETY SNAPSHOT (deep) ──────────────────────────────────────────────
  const snapPresets = JSON.parse(JSON.stringify(view.settings.lensPresets || []));
  const snapEncoding = JSON.parse(JSON.stringify(view.settings.encoding || []));
  out.snapPresetCount = snapPresets.length;

  // refreshFilterTab() needs the live note menu DOM; open it + draw() first.
  try { if (!view.settings.noteMenuVisible) view.toggleNoteMenu(); view.draw(); await sleep(80); } catch (e) {}

  // helpers: render the JSON body into a detached host and grab the controls
  const renderJson = () => {
    const host = document.createElement("div");
    view.dataSubTab = "json";
    view.renderDataJsonBody(host);
    const tas = Array.from(host.querySelectorAll("textarea"));
    const btn = (label) => Array.from(host.querySelectorAll("button")).find(b => (b.textContent||"").trim() === label);
    return { host, exportTa: tas[0], importTa: tas[1], btn };
  };
  // After a click handler re-renders the host in place, re-query it.
  const grab = (host) => {
    const tas = Array.from(host.querySelectorAll("textarea"));
    const btn = (label) => Array.from(host.querySelectorAll("button")).find(b => (b.textContent||"").trim() === label);
    const statusLines = Array.from(host.querySelectorAll("div")).map(d => (d.textContent||"").trim());
    return { exportTa: tas[0], importTa: tas[1], btn, statusLines };
  };

  const BUNDLED_NAMES = ["Tag Overview (Euler)","Co-occurrence Heatmap","Intersection Lattice","Icon Gallery","UpSet Plot"];
  const namesOf = () => (view.settings.lensPresets||[]).map(p => p.name);

  try {
    // 1) export-serialize ───────────────────────────────────────────────────
    try {
      const { exportTa } = renderJson();
      const v = exportTa ? exportTa.value : "";
      const okSchema = has(v, '"schema": "tag-lens/presets"');
      const okVersion = has(v, '"version"');
      out.checks["export-serialize"] = okSchema && okVersion
        ? { pass: true }
        : { pass: false, why: "schema=" + okSchema + " version=" + okVersion + " head=" + v.slice(0, 80) };
    } catch (e) { out.checks["export-serialize"] = { pass: false, why: "threw: " + (e && e.stack || e) }; }

    // 2) load-bundled (+ idempotent on 2nd click) ────────────────────────────
    try {
      const r1 = renderJson();
      const before = view.settings.lensPresets.length;
      r1.btn("Load bundled presets").click();
      await sleep(60);
      const afterFirst = view.settings.lensPresets.length;
      const names = namesOf();
      const allPresent = BUNDLED_NAMES.every(n => names.includes(n));
      const grew = afterFirst > before || BUNDLED_NAMES.every(n => snapPresets.some(p=>p.name===n)); // grew, unless all already existed
      // idempotency: click again on a freshly rendered host, count must not grow
      const r2 = renderJson();
      r2.btn("Load bundled presets").click();
      await sleep(60);
      const afterSecond = view.settings.lensPresets.length;
      out.checks["load-bundled"] = (allPresent && afterSecond === afterFirst)
        ? { pass: true, detail: "before=" + before + " after1=" + afterFirst + " after2=" + afterSecond }
        : { pass: false, why: "allPresent=" + allPresent + " after1=" + afterFirst + " after2=" + afterSecond + " (idempotent fail if after2>after1)" };
    } catch (e) { out.checks["load-bundled"] = { pass: false, why: "threw: " + (e && e.stack || e) }; }

    // 3) import-roundtrip ────────────────────────────────────────────────────
    const RT_NAME = "E2E-RoundTrip-XYZ";
    try {
      const bundle = {
        schema: "tag-lens/presets",
        version: 1,
        presets: [{
          name: RT_NAME,
          query: { where: [], groupBy: [], having: [], limit: [], viewMode: "euler" }
        }]
      };
      const r = renderJson();
      r.importTa.value = JSON.stringify(bundle);
      const cntBefore = view.settings.lensPresets.length;
      r.btn("Import").click();
      await sleep(60);
      const present = namesOf().includes(RT_NAME);
      const grew = view.settings.lensPresets.length === cntBefore + 1;
      // status: importBtn re-renders host in place — re-grab from same host
      const g = grab(r.host);
      const okStatus = g.statusLines.some(s => has(s, "Imported 1 preset"));
      const noErrLines = !g.statusLines.some(s => s.startsWith("\\u2022")); // bullet error lines
      out.checks["import-roundtrip"] = (present && grew && okStatus)
        ? { pass: true, detail: "status ok, +1 preset" }
        : { pass: false, why: "present=" + present + " grew=" + grew + " status=" + okStatus + " lines=" + JSON.stringify(g.statusLines.slice(0,6)) };
    } catch (e) { out.checks["import-roundtrip"] = { pass: false, why: "threw: " + (e && e.stack || e) }; }

    // 4) import-tolerant (bad JSON must not throw, must not change count) ─────
    try {
      const r = renderJson();
      const cntBefore = view.settings.lensPresets.length;
      r.importTa.value = "{ not json ]";
      r.btn("Import").click();
      await sleep(60);
      const cntAfter = view.settings.lensPresets.length;
      const g = grab(r.host);
      const showsError = g.statusLines.some(s => has(s, "Invalid JSON") || has(s, "No valid presets"));
      out.checks["import-tolerant"] = (cntAfter === cntBefore && showsError)
        ? { pass: true, detail: "count unchanged (" + cntAfter + "), error shown" }
        : { pass: false, why: "before=" + cntBefore + " after=" + cntAfter + " errShown=" + showsError + " lines=" + JSON.stringify(g.statusLines.slice(0,6)) };
    } catch (e) { out.checks["import-tolerant"] = { pass: false, why: "threw: " + (e && e.stack || e) }; }

    // 5) no-crash (rebuild + draw after all the mutations) ────────────────────
    try {
      await view.rebuild();
      view.draw();
      out.checks["no-crash"] = { pass: true };
    } catch (e) { out.checks["no-crash"] = { pass: false, why: "rebuild/draw threw: " + (e && e.stack || e) }; }

  } finally {
    // ── SAFETY RESTORE (highest priority — leave the dev vault untouched) ──
    try {
      view.settings.lensPresets = JSON.parse(JSON.stringify(snapPresets));
      view.settings.encoding = JSON.parse(JSON.stringify(snapEncoding));
      await view.save();
      try { view.syncLensCommands(view.settings.lensPresets); } catch (e) {}
      try { view.refreshFilterTab(); } catch (e) {}
      out.finalPresetCount = view.settings.lensPresets.length;
      out.restored = true;

      // 6) selection-invariant (encoding deep-equal after restore) ───────────
      const encNow = JSON.stringify(view.settings.encoding || []);
      const encSnap = JSON.stringify(snapEncoding);
      out.checks["selection-invariant"] = (encNow === encSnap)
        ? { pass: true, detail: "encoding deep-equal after restore" }
        : { pass: false, why: "encoding differs after restore" };
    } catch (e) {
      out.checks["selection-invariant"] = { pass: false, why: "restore threw: " + (e && e.stack || e) };
    }
  }

  return out;
})()`;

const evaluatePromise = send("Runtime.evaluate", { expression: driver, awaitPromise: true, returnByValue: true });
const timeoutPromise = new Promise((_, rej) => setTimeout(() => rej(new Error("E2E Test Hung Up (Timeout 60s)")), 60000));
let resp;
try {
  resp = await Promise.race([evaluatePromise, timeoutPromise]);
} catch (err) {
  console.error("FAIL (fatal):", err.message);
  ws.close();
  process.exit(1);
}
if (resp.result?.exceptionDetails) {
  console.error("FAIL: driver threw:", JSON.stringify(resp.result.exceptionDetails).slice(0, 800));
  process.exit(1);
}
const report = resp.result.result.value;
await new Promise((r) => setTimeout(r, 800)); // drain late async console errors

if (report.fatal) { console.error("FAIL (fatal):", report.fatal); process.exit(1); }

let failures = 0;
const ORDER = ["export-serialize", "load-bundled", "import-roundtrip", "import-tolerant", "no-crash", "selection-invariant"];
console.log("\\n==== F1 (Preset JSON import/export) E2E ====\\n");
for (const k of ORDER) {
  const c = report.checks[k];
  if (!c) { failures++; console.log(`  ✗ ${k.padEnd(22)} MISSING (check did not run)`); continue; }
  if (c.pass) console.log(`  ✓ ${k.padEnd(22)} PASS${c.detail ? "  — " + c.detail : ""}`);
  else { failures++; console.log(`  ✗ ${k.padEnd(22)} FAIL — ${c.why}`); }
}

console.log(`\\nsnapshot presets: ${report.snapPresetCount}  |  final presets: ${report.finalPresetCount}  |  restored: ${report.restored}`);
if (!report.restored || report.finalPresetCount !== report.snapPresetCount) {
  failures++;
  console.log("  ✗ dev vault NOT restored to original preset count!");
} else {
  console.log("  ✓ dev vault restored (preset count matches snapshot)");
}

if (consoleErrors.length) {
  console.log(`\\nconsole errors captured (${consoleErrors.length}):`);
  for (const c of consoleErrors.slice(0, 20)) console.log("  ! " + c.slice(0, 200));
  const relevant = consoleErrors.filter((c) => /tag-lens|preset|MiniGraphView|view\.ts|parsePresets|mergePresets/i.test(c));
  if (relevant.length) { failures += relevant.length; console.log(`  -> ${relevant.length} look Tag Lens-related (counted as failures)`); }
}

console.log("\\n==== F1 E2E result: " + (failures === 0 ? "PASS ✅" : "FAIL ✗ (" + failures + " issue(s))") + " ====");
ws.close();
process.exit(failures === 0 ? 0 : 1);
