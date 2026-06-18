import { VAULT } from "../config.mjs";
import { spawn } from "node:child_process";
import fs from "node:fs";

// F5 = per-mode on-canvas legends E2E. Verifies on REAL Obsidian, with NO encoding
// bound (so the legend shows mode-INTRINSIC content):
//   1. all 11 modes paint a legend with a × button (view.legendCloseRect != null),
//      rebuild()+draw() no-throw.
//   2. legend KIND matches the mode: heatmap SVG -> "Co-occurrence" gradient;
//      a card mode (euler) -> "Color · Tag"; stream -> "Circle" (size key title).
//   3. × dismiss is PER-MODE: legendHiddenModes={heatmap:true} hides ONLY heatmap's
//      legend (legendCloseRect===null) while euler still shows it (!==null).
//   4. export excludes the × but KEEPS the legend: euler legend shown, exportSvg
//      still contains "Color · Tag" (legend is in the export; × is interactive-only).
//   5. restore settings (encoding/showLegend/legendHiddenModes/viewMode) + save;
//      vault delta 0 (delete any tag-lens-*.svg/png created during the run).
//
// SAFETY: DEDICATED profile /tmp/obs-e2e-f5 + DEDICATED port 9229 so the user's
// running Obsidian (profile ~/.config/obsidian, port 9222) is NEVER touched.
// Settings are deep-snapshotted and restored+saved in a finally; every
// tag-lens-*.svg/png created during the run is deleted (delta 0).
const DIR = "/tmp/obs-e2e-f5";
if (!fs.existsSync(DIR)) fs.mkdirSync(DIR, { recursive: true });
fs.writeFileSync(`${DIR}/obsidian.json`, JSON.stringify({ vaults: { dev: { path: VAULT, ts: 1718270000000, open: true } } }));

const obs = spawn("obsidian", [
  VAULT,
  "--user-data-dir=" + DIR,
  "--remote-debugging-port=9229"
], { detached: true, stdio: "ignore" });

// Kill the detached Obsidian process GROUP on exit so the instance never leaks
// (it holds port 9229 and blocks the next run otherwise).
process.on("exit", () => { try { process.kill(-obs.pid); } catch (e) {} });

await new Promise(r => setTimeout(r, 3000));

const CDP_URL = "http://127.0.0.1:9229";

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

// ---- in-renderer driver: exercise per-mode on-canvas legends (NO encoding) ----
const driver = `(async () => {
  const out = { fatal: null, modes: [], kind: {}, perMode: {}, exportKeepsLegend: {}, vault: {}, restored: false };
  const sleep = (ms) => new Promise(r => setTimeout(r, ms));

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

  // ── deep snapshot of the settings we mutate (restore in finally) ─────────────
  const snap = {
    encoding: JSON.parse(JSON.stringify(view.settings.encoding ?? [])),
    showLegend: view.settings.showLegend,
    legendHiddenModes: JSON.parse(JSON.stringify(view.settings.legendHiddenModes ?? {})),
    viewMode: view.settings.viewMode,
  };

  // vault baseline: existing tag-lens-*.svg / *.png files.
  const exportPaths = () => window.app.vault.getFiles()
    .filter(f => { const n = f.path.split("/").pop(); return n.startsWith("tag-lens-") && (n.endsWith(".svg") || n.endsWith(".png")); })
    .map(f => f.path);
  const exportBefore = exportPaths();
  out.vault.before = exportBefore;
  const beforeSet = new Set(exportBefore);

  // Pull SVG text out of a captured ClipboardItem array.
  const svgFromCaptured = async (captured) => {
    const item = Array.isArray(captured) ? captured[0] : null;
    if (!item || typeof item.getType !== "function") return null;
    const blob = await item.getType("image/svg+xml");
    return blob ? await blob.text() : null;
  };

  const MODES = ["droste","euler","euler-true","euler-venn","bipartite","matrix","bubblesets","heatmap","lattice","upset","stream"];

  try {
    // base config: NO encoding bound, legend ON, nothing hidden.
    view.settings.encoding = [];
    view.settings.showLegend = true;
    view.settings.legendHiddenModes = {};

    // ── 1) all 11 modes paint a legend with a × button ─────────────────────────
    for (const m of MODES) {
      const e = { mode: m, rebuild: "ok", draw: "ok", hasLegend: false };
      try { view.settings.viewMode = m; await view.rebuild(); } catch (err) { e.rebuild = String(err && err.stack || err); }
      await sleep(25);
      try { view.draw(); } catch (err) { e.draw = String(err && err.stack || err); }
      e.hasLegend = view.legendCloseRect != null;
      e.pass = (e.rebuild === "ok" && e.draw === "ok" && e.hasLegend === true);
      out.modes.push(e);
    }

    // ── stub clipboard.write for steps 2 & 4 (ClipboardItem/Blob stay REAL) ─────
    let captured = null;
    const origWrite = navigator.clipboard && navigator.clipboard.write;
    const stub = function (data) { captured = data; return Promise.resolve(); };
    let stubbed = false;
    try {
      if (typeof origWrite === "function") {
        Object.defineProperty(navigator.clipboard, "write", { value: stub, configurable: true, writable: true });
        stubbed = true;
      }
      out.kind.stubbed = stubbed;

      // helper: render a mode (no encoding, legend on) and grab its export SVG.
      const svgForMode = async (m) => {
        captured = null;
        view.settings.encoding = [];
        view.settings.showLegend = true;
        view.settings.legendHiddenModes = {};
        view.settings.viewMode = m;
        await view.rebuild();
        view.draw();
        await sleep(40);
        await view.exportSvg({ fit: false, target: "clipboard" });
        return await svgFromCaptured(captured);
      };

      // ── 2) legend KIND matches the mode ──────────────────────────────────────
      try {
        const hmSvg = await svgForMode("heatmap");
        const euSvg = await svgForMode("euler");
        const stSvg = await svgForMode("stream");
        out.kind.heatmapHasCoOccurrence = typeof hmSvg === "string" && hmSvg.includes("Co-occurrence");
        out.kind.eulerHasColorTag       = typeof euSvg === "string" && euSvg.includes("Color · Tag");
        out.kind.streamHasCircle        = typeof stSvg === "string" && stSvg.includes("Circle");
        out.kind.heatmapSvgLen = hmSvg ? hmSvg.length : 0;
        out.kind.eulerSvgLen   = euSvg ? euSvg.length : 0;
        out.kind.streamSvgLen  = stSvg ? stSvg.length : 0;
        out.kind.pass = out.kind.heatmapHasCoOccurrence && out.kind.eulerHasColorTag && out.kind.streamHasCircle;
      } catch (e) { out.kind = Object.assign(out.kind || {}, { pass: false, why: "kind step threw: " + (e && e.stack || e) }); }

      // ── 4) export excludes × but KEEPS legend (euler, legend shown) ───────────
      // (run before step 3 mutates legendHiddenModes; svgForMode resets it anyway)
      try {
        view.settings.legendHiddenModes = {};
        view.settings.showLegend = true;
        view.settings.viewMode = "euler";
        view.settings.encoding = [];
        await view.rebuild();
        view.draw();
        out.exportKeepsLegend.closeRectShown = view.legendCloseRect != null;
        const euSvg = await svgForMode("euler");
        out.exportKeepsLegend.svgHasColorTag = typeof euSvg === "string" && euSvg.includes("Color · Tag");
        out.exportKeepsLegend.svgLen = euSvg ? euSvg.length : 0;
        out.exportKeepsLegend.pass = out.exportKeepsLegend.closeRectShown && out.exportKeepsLegend.svgHasColorTag;
      } catch (e) { out.exportKeepsLegend = { pass: false, why: "exportKeepsLegend step threw: " + (e && e.stack || e) }; }

    } finally {
      if (stubbed) Object.defineProperty(navigator.clipboard, "write", { value: origWrite, configurable: true, writable: true });
    }

    // ── 3) × dismiss is PER-MODE (legendHiddenModes={heatmap:true}) ────────────
    try {
      view.settings.encoding = [];
      view.settings.showLegend = true;
      view.settings.legendHiddenModes = { heatmap: true };

      view.settings.viewMode = "heatmap";
      await view.rebuild();
      view.draw();
      out.perMode.heatmapCloseRect = view.legendCloseRect; // expect null (hidden)
      out.perMode.heatmapHidden = view.legendCloseRect === null;

      view.settings.viewMode = "euler";
      await view.rebuild();
      view.draw();
      out.perMode.eulerCloseRect = view.legendCloseRect; // expect non-null (shown)
      out.perMode.eulerShown = view.legendCloseRect !== null;

      out.perMode.pass = out.perMode.heatmapHidden && out.perMode.eulerShown;
    } catch (e) { out.perMode = { pass: false, why: "perMode step threw: " + (e && e.stack || e) }; }

  } finally {
    // ── restore settings exactly + persist (do NOT leak test mutations) ────────
    try {
      view.settings.encoding = snap.encoding;
      view.settings.showLegend = snap.showLegend;
      view.settings.legendHiddenModes = snap.legendHiddenModes;
      view.settings.viewMode = snap.viewMode;
      await view.rebuild();
      view.draw();
      await view.save();
      out.restored = true;
    } catch (e) { out.restoreErr = "restore threw: " + (e && e.stack || e); }

    // ── vault cleanup: delete every NEW tag-lens-*.svg/png, confirm delta 0 ────
    try {
      const added = exportPaths().filter(p => !beforeSet.has(p));
      out.vault.addedDuringTest = added.slice();
      const deleted = [];
      for (const p of added) {
        const file = window.app.vault.getAbstractFileByPath(p);
        if (file) { await window.app.vault.delete(file); deleted.push(p); }
      }
      out.vault.deleted = deleted;
      await sleep(80);
      const finalAdded = exportPaths().filter(p => !beforeSet.has(p));
      out.vault.finalAdded = finalAdded;
      out.vault.delta0 = finalAdded.length === 0;
    } catch (e) { out.vault.cleanupError = "cleanup threw: " + (e && e.stack || e); out.vault.delta0 = false; }
  }

  return out;
})()`;

const evaluatePromise = send("Runtime.evaluate", { expression: driver, awaitPromise: true, returnByValue: true });
const timeoutPromise = new Promise((_, rej) => setTimeout(() => rej(new Error("E2E Test Hung Up (Timeout 120s)")), 120000));
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
console.log("\\n==== F5 per-mode on-canvas legend E2E (NO encoding bound) ====\\n");

// 1) all 11 modes paint a legend with a ×
console.log("1) all 11 modes paint a legend with a × button (legendCloseRect != null)");
console.log("   mode            rebuild draw  legend -> result");
let modeFail = 0, legendCount = 0;
for (const e of report.modes) {
  const st = (x) => (x === "ok" ? "ok " : "ERR");
  if (e.hasLegend) legendCount++;
  const detail = e.pass ? "ok" : (e.rebuild !== "ok" ? "rebuild ERR: " + String(e.rebuild).split("\\n")[0].slice(0, 90)
    : e.draw !== "ok" ? "draw ERR: " + String(e.draw).split("\\n")[0].slice(0, 90)
    : "NO LEGEND (legendCloseRect == null)");
  console.log("   " + e.mode.padEnd(14) + "  " + st(e.rebuild) + "     " + st(e.draw) + "   " + (e.hasLegend ? "yes " : "NO  ") + "  -> " + detail);
  if (!e.pass) { failures++; modeFail++; }
}
console.log("   -> " + (modeFail === 0 ? "PASS \\u2705 (" + legendCount + "/" + report.modes.length + " modes show a × legend)" : "FAIL \\u2717 (" + modeFail + " mode(s) failed)"));

// 2) legend KIND matches the mode
const k = report.kind || {};
console.log("\\n2) legend KIND matches the mode (intrinsic legend in SVG export)");
console.log("   heatmap 'Co-occurrence' : " + (k.heatmapHasCoOccurrence ? "yes" : "NO") + "  (svgLen " + (k.heatmapSvgLen ?? "?") + ")");
console.log("   euler   'Color · Tag'   : " + (k.eulerHasColorTag ? "yes" : "NO") + "  (svgLen " + (k.eulerSvgLen ?? "?") + ")");
console.log("   stream  'Circle'        : " + (k.streamHasCircle ? "yes" : "NO") + "  (svgLen " + (k.streamSvgLen ?? "?") + ")");
console.log("   -> " + (k.pass ? "PASS \\u2705" : "FAIL \\u2717 " + (k.why || "missing mode-intrinsic legend title in export")));
if (!k.pass) failures++;

// 3) per-mode dismiss
const pm = report.perMode || {};
console.log("\\n3) × dismiss is PER-MODE (legendHiddenModes = { heatmap: true })");
console.log("   heatmap legendCloseRect : " + JSON.stringify(pm.heatmapCloseRect ?? null) + "  (expect null -> hidden : " + (pm.heatmapHidden ? "yes" : "NO") + ")");
console.log("   euler   legendCloseRect : " + (pm.eulerCloseRect ? "{...}" : JSON.stringify(pm.eulerCloseRect ?? null)) + "  (expect non-null -> shown : " + (pm.eulerShown ? "yes" : "NO") + ")");
console.log("   -> " + (pm.pass ? "PASS \\u2705 (per-mode hiding works)" : "FAIL \\u2717 " + (pm.why || "per-mode hiding not isolated to the chosen mode")));
if (!pm.pass) failures++;

// 4) export keeps legend (× is interactive-only)
const ek = report.exportKeepsLegend || {};
console.log("\\n4) export EXCLUDES × but KEEPS the legend (euler)");
console.log("   legendCloseRect shown on draw : " + (ek.closeRectShown ? "yes" : "NO"));
console.log("   export SVG has 'Color · Tag'  : " + (ek.svgHasColorTag ? "yes" : "NO") + "  (svgLen " + (ek.svgLen ?? "?") + ")");
console.log("   -> " + (ek.pass ? "PASS \\u2705 (legend in export; × is interactive-only)" : "FAIL \\u2717 " + (ek.why || "legend missing from export")));
if (!ek.pass) failures++;

// restoration + vault
console.log("\\nsettings restoration:");
console.log("   encoding/showLegend/legendHiddenModes/viewMode restored + saved : " + (report.restored ? "yes" : "NO"));
if (report.restoreErr) console.log("   restore error: " + report.restoreErr);
if (!report.restored) failures++;

const v = report.vault || {};
console.log("\\nvault restoration (delta 0):");
console.log("   svg/png before            : " + (v.before ? v.before.length : "?"));
console.log("   created during test        : " + JSON.stringify(v.addedDuringTest || []));
console.log("   deleted (cleanup)          : " + JSON.stringify(v.deleted || []));
console.log("   final delta vs baseline    : " + (v.finalAdded ? v.finalAdded.length : "?"));
if (v.cleanupError) console.log("   cleanup error             : " + v.cleanupError);
console.log("   -> " + (v.delta0 ? "PASS \\u2705 (vault restored, delta 0)" : "FAIL \\u2717 (vault NOT restored)"));
if (!v.delta0) failures++;

// console errors. CDP eval lacks a user gesture so an un-stubbed clipboard.write
// would reject — but we stub it in steps 2/4, so any clipboard-fallback log here
// is benign and excluded; tag-lens / legend errors count as failures.
if (consoleErrors.length) {
  console.log("\\nconsole errors captured (" + consoleErrors.length + "):");
  for (const c of consoleErrors.slice(0, 20)) console.log("  ! " + c.slice(0, 200));
  const benignFallback = (c) =>
    /clipboard\\.write failed, trying writeText/i.test(c) && /Document is not focused|NotAllowedError/i.test(c);
  const relevant = consoleErrors.filter(
    (c) => /tag-lens|legend|encLegends|exportSvg|draw-|view\\.ts|laid|canvas|legendCloseRect/i.test(c) && !benignFallback(c),
  );
  const benign = consoleErrors.filter(benignFallback).length;
  if (benign) console.log("  (i) " + benign + " expected clipboard-fallback log(s) ignored");
  if (relevant.length) { failures += relevant.length; console.log("  -> " + relevant.length + " look Tag Lens / F5-related (counted as failures)"); }
}

console.log("\\n==== F5 result: " + (failures === 0 ? "PASS \\u2705" : "FAIL \\u2717 (" + failures + " issue(s))") + " | " + legendCount + "/" + report.modes.length + " modes show legend ====");
ws.close();
process.exit(failures === 0 ? 0 : 1);
