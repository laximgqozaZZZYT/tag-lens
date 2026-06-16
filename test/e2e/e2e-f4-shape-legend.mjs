import { VAULT } from "../config.mjs";
import { spawn } from "node:child_process";
import fs from "node:fs";

// F4 = shape encode channel + on-canvas legend E2E. Verifies on REAL Obsidian:
//   - shape channel: categorical/ordinal field -> shape token (circle/square/...)
//     lands in view.encParams.get(id).shape; node cards paint a small marker.
//   - on-canvas legend: view.settings.showLegend (default true) && encLegends>0
//     -> drawn bottom-left in drawGlobalDisplayFallbacks; title "<Channel> · <Field>".
//   - the legend is drawn inside draw(), so it is captured by SVG export (F3).
//
// Checks:
//   1. shape params    — shape binding -> >=1 encParams.shape ∈ {circle,...,star};
//                        view.draw() no-throw.
//   2. selection inert — laid.nodes count identical with shape binding ON vs [].
//   3. legend in SVG   — color+shape bindings, showLegend ON; stub clipboard.write,
//                        exportSvg(clipboard), pull image/svg+xml blob: well-formed
//                        (DOMParser, no parsererror), contains "Color · Tag" AND
//                        "Shape · Maturity", and >1 <path (shape glyphs).
//   4. legend toggle   — showLegend OFF -> SVG no longer contains "Shape · Maturity".
//   5. all-modes smoke — 11 modes with shape+color bound: rebuild()+draw() no-throw.
//
// SAFETY: DEDICATED profile /tmp/obs-e2e-f4 + DEDICATED port 9229 so the user's
// running Obsidian (profile ~/.config/obsidian, port 9222) is NEVER touched.
// Settings (encoding/showLegend) are deep-snapshotted and restored+saved in a
// finally; every tag-lens-*.svg/png created during the run is deleted (delta 0).
const DIR = "/tmp/obs-e2e-f4";
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

// ---- in-renderer driver: exercise shape channel + on-canvas legend ----
const driver = `(async () => {
  const out = { fatal: null, shape: {}, selection: {}, legendSvg: {}, legendOff: {}, modes: [], vault: {}, restored: false };
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
    viewMode: view.settings.viewMode,
  };

  // vault baseline: existing tag-lens-*.svg / *.png files.
  const exportPaths = () => window.app.vault.getFiles()
    .filter(f => { const n = f.path.split("/").pop(); return n.startsWith("tag-lens-") && (n.endsWith(".svg") || n.endsWith(".png")); })
    .map(f => f.path);
  const exportBefore = exportPaths();
  out.vault.before = exportBefore;
  const beforeSet = new Set(exportBefore);

  const SHAPE_TOKENS = ["circle","square","triangle","diamond","hexagon","star"];

  const checkSvg = (svg) => {
    const r = { ok: false, wellFormed: false };
    if (typeof svg !== "string" || svg.length === 0) { r.why = "empty/non-string svg"; return r; }
    let doc = null, parserErr = true;
    try {
      doc = new DOMParser().parseFromString(svg, "image/svg+xml");
      parserErr = !!doc.querySelector("parsererror");
    } catch (e) { r.parseThrew = String(e); }
    r.wellFormed = !parserErr;
    r.pathCount = doc ? doc.querySelectorAll("path").length : 0;
    r.ok = r.wellFormed;
    return r;
  };

  // Pull SVG text out of a captured ClipboardItem array.
  const svgFromCaptured = async (captured) => {
    const item = Array.isArray(captured) ? captured[0] : null;
    if (!item || typeof item.getType !== "function") return null;
    const blob = await item.getType("image/svg+xml");
    return blob ? await blob.text() : null;
  };

  try {
    // ── 1) shape params reflect a categorical/ordinal binding ──────────────────
    try {
      view.settings.viewMode = "euler";
      view.settings.encoding = [{ channelId: "shape", fieldId: "maturity", enabled: true, scale: { type: "categorical" } }];
      await view.rebuild();
      const params = Array.from(view.encParams.values());
      const withShape = params.filter(p => p.shape != null);
      out.shape.totalParams = params.length;
      out.shape.withShape = withShape.length;
      out.shape.sampleShapes = Array.from(new Set(withShape.map(p => p.shape))).slice(0, 8);
      out.shape.allValidTokens = withShape.length > 0 && withShape.every(p => SHAPE_TOKENS.includes(p.shape));
      let drawErr = null;
      try { view.draw(); } catch (e) { drawErr = String(e && e.stack || e); }
      out.shape.drawErr = drawErr;
      out.shape.pass = withShape.length >= 1 && out.shape.allValidTokens && !drawErr;
      // record selected node count with shape binding ON for step 2.
      out.selection.withEnc = view.laid.nodes.length;
    } catch (e) { out.shape = { pass: false, why: "shape step threw: " + (e && e.stack || e) }; }

    // ── 2) selection non-interference: enc OFF must keep laid.nodes count ───────
    try {
      view.settings.encoding = [];
      await view.rebuild();
      out.selection.withoutEnc = view.laid.nodes.length;
      out.selection.pass = (out.selection.withEnc != null) && (out.selection.withEnc === out.selection.withoutEnc);
    } catch (e) { out.selection = Object.assign(out.selection || {}, { pass: false, why: "selection step threw: " + (e && e.stack || e) }); }

    // ── stub clipboard.write for steps 3 & 4 (ClipboardItem/Blob stay REAL) ─────
    let captured = null;
    const origWrite = navigator.clipboard && navigator.clipboard.write;
    const stub = function (data) { captured = data; return Promise.resolve(); };
    let stubbed = false;
    try {
      if (typeof origWrite === "function") {
        Object.defineProperty(navigator.clipboard, "write", { value: stub, configurable: true, writable: true });
        stubbed = true;
      }
      out.legendSvg.stubbed = stubbed;

      // ── 3) legend appears in SVG (color + shape, showLegend ON) ──────────────
      try {
        captured = null;
        view.settings.showLegend = true;
        view.settings.viewMode = "euler";
        view.settings.encoding = [
          { channelId: "color", fieldId: "tag", enabled: true, scale: { type: "categorical" } },
          { channelId: "shape", fieldId: "maturity", enabled: true, scale: { type: "categorical" } },
        ];
        await view.rebuild();
        out.legendSvg.encLegends = (view.encLegends || []).length;
        view.draw();
        await sleep(40);
        await view.exportSvg({ fit: false, target: "clipboard" });
        const svg = await svgFromCaptured(captured);
        if (svg == null) { out.legendSvg = Object.assign(out.legendSvg, { pass: false, why: "no image/svg+xml captured" }); }
        else {
          const chk = checkSvg(svg);
          out.legendSvg.wellFormed = chk.wellFormed;
          out.legendSvg.pathCount = chk.pathCount;
          out.legendSvg.hasColorTag = svg.includes("Color · Tag");
          out.legendSvg.hasShapeMaturity = svg.includes("Shape · Maturity");
          out.legendSvg.svgLen = svg.length;
          out.legendSvg.pass = chk.wellFormed && out.legendSvg.hasColorTag && out.legendSvg.hasShapeMaturity && chk.pathCount > 1;
        }
      } catch (e) { out.legendSvg = Object.assign(out.legendSvg || {}, { pass: false, why: "legendSvg step threw: " + (e && e.stack || e) }); }

      // ── 4) showLegend OFF -> "Shape · Maturity" no longer in SVG ─────────────
      try {
        captured = null;
        view.settings.showLegend = false;
        await view.rebuild();
        view.draw();
        await sleep(40);
        await view.exportSvg({ fit: false, target: "clipboard" });
        const svg = await svgFromCaptured(captured);
        if (svg == null) { out.legendOff = { pass: false, why: "no image/svg+xml captured" }; }
        else {
          const chk = checkSvg(svg);
          out.legendOff.wellFormed = chk.wellFormed;
          out.legendOff.hasShapeMaturity = svg.includes("Shape · Maturity");
          out.legendOff.svgLen = svg.length;
          out.legendOff.pass = chk.wellFormed && !out.legendOff.hasShapeMaturity;
        }
      } catch (e) { out.legendOff = { pass: false, why: "legendOff step threw: " + (e && e.stack || e) }; }
    } finally {
      if (stubbed) Object.defineProperty(navigator.clipboard, "write", { value: origWrite, configurable: true, writable: true });
    }

    // ── 5) all-modes smoke: shape+color bound, rebuild()+draw() no-throw ───────
    try {
      view.settings.showLegend = true;
      view.settings.encoding = [
        { channelId: "color", fieldId: "tag", enabled: true, scale: { type: "categorical" } },
        { channelId: "shape", fieldId: "maturity", enabled: true, scale: { type: "categorical" } },
      ];
      const MODES = ["droste","euler","euler-true","euler-venn","bipartite","matrix","bubblesets","heatmap","lattice","upset","stream"];
      for (const m of MODES) {
        const e = { mode: m, rebuild: "ok", draw: "ok" };
        try { view.settings.viewMode = m; await view.rebuild(); } catch (err) { e.rebuild = String(err && err.stack || err); }
        await sleep(25);
        try { view.draw(); } catch (err) { e.draw = String(err && err.stack || err); }
        e.pass = (e.rebuild === "ok" && e.draw === "ok");
        out.modes.push(e);
      }
    } catch (e) { out.modesFatal = "modes loop threw: " + (e && e.stack || e); }

  } finally {
    // ── restore settings exactly + persist (do NOT leak test mutations) ────────
    try {
      view.settings.encoding = snap.encoding;
      view.settings.showLegend = snap.showLegend;
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
const timeoutPromise = new Promise((_, rej) => setTimeout(() => rej(new Error("E2E Test Hung Up (Timeout 90s)")), 90000));
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
console.log("\\n==== F4 shape channel + on-canvas legend E2E ====\\n");

// 1) shape params
const s = report.shape || {};
console.log("1) shape params reflect categorical/ordinal binding");
console.log("   encParams total : " + (s.totalParams ?? "?") + "  | with .shape : " + (s.withShape ?? "?"));
console.log("   sample tokens   : " + JSON.stringify(s.sampleShapes || []));
console.log("   all valid token : " + (s.allValidTokens ? "yes" : "NO") + "  | draw err : " + (s.drawErr || "none"));
console.log("   -> " + (s.pass ? "PASS \\u2705" : "FAIL \\u2717 " + (s.why || "no valid shape tokens / draw threw")));
if (!s.pass) failures++;

// 2) selection non-interference
const sel = report.selection || {};
console.log("\\n2) selection non-interference (laid.nodes unchanged by encoding)");
console.log("   nodes enc ON : " + (sel.withEnc ?? "?") + "  | enc OFF : " + (sel.withoutEnc ?? "?"));
console.log("   -> " + (sel.pass ? "PASS \\u2705" : "FAIL \\u2717 " + (sel.why || "node count changed (encoding leaked into selection)")));
if (!sel.pass) failures++;

// 3) legend in SVG
const ls = report.legendSvg || {};
console.log("\\n3) legend captured in SVG export (showLegend ON, color+shape)");
console.log("   encLegends : " + (ls.encLegends ?? "?") + "  | svgLen : " + (ls.svgLen ?? "?") + "  | <path> count : " + (ls.pathCount ?? "?"));
console.log("   well-formed: " + (ls.wellFormed ? "yes" : "NO"));
console.log("   'Color · Tag'      present : " + (ls.hasColorTag ? "yes" : "NO"));
console.log("   'Shape · Maturity' present : " + (ls.hasShapeMaturity ? "yes" : "NO"));
console.log("   -> " + (ls.pass ? "PASS \\u2705" : "FAIL \\u2717 " + (ls.why || "missing legend titles / glyph paths / malformed")));
if (!ls.pass) failures++;

// 4) legend toggle off
const lo = report.legendOff || {};
console.log("\\n4) showLegend OFF -> legend gone from SVG");
console.log("   well-formed: " + (lo.wellFormed ? "yes" : "NO") + "  | 'Shape · Maturity' present : " + (lo.hasShapeMaturity ? "yes (BAD)" : "no"));
console.log("   -> " + (lo.pass ? "PASS \\u2705" : "FAIL \\u2717 " + (lo.why || "legend still present after toggle off")));
if (!lo.pass) failures++;

// 5) all-modes smoke
console.log("\\n5) all-modes smoke (shape+color bound, rebuild+draw no-throw)");
console.log("   mode            rebuild draw  -> result");
let modeFail = 0;
for (const e of report.modes) {
  const st = (x) => (x === "ok" ? "ok " : "ERR");
  console.log("   " + e.mode.padEnd(14) + "  " + st(e.rebuild) + "     " + st(e.draw) + "  -> " + (e.pass ? "ok" : "ERR: " + String(e.rebuild !== "ok" ? e.rebuild : e.draw).split("\\n")[0].slice(0, 120)));
  if (!e.pass) { failures++; modeFail++; }
}
if (report.modesFatal) { console.log("   modes loop fatal: " + report.modesFatal); failures++; }
console.log("   -> " + (modeFail === 0 && !report.modesFatal ? "PASS \\u2705 (" + report.modes.length + "/11 modes)" : "FAIL \\u2717 (" + modeFail + " mode(s) errored)"));

// restoration + vault
console.log("\\nsettings restoration:");
console.log("   encoding/showLegend restored + saved : " + (report.restored ? "yes" : "NO"));
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
// would reject — but we stub it in steps 3/4, so any clipboard-fallback log here
// is benign and excluded; tag-lens / shape / legend errors count as failures.
if (consoleErrors.length) {
  console.log("\\nconsole errors captured (" + consoleErrors.length + "):");
  for (const c of consoleErrors.slice(0, 20)) console.log("  ! " + c.slice(0, 200));
  const benignFallback = (c) =>
    /clipboard\\.write failed, trying writeText/i.test(c) && /Document is not focused|NotAllowedError/i.test(c);
  const relevant = consoleErrors.filter(
    (c) => /tag-lens|shape|legend|encParams|encLegends|exportSvg|draw-|view\\.ts|laid|canvas/i.test(c) && !benignFallback(c),
  );
  const benign = consoleErrors.filter(benignFallback).length;
  if (benign) console.log("  (i) " + benign + " expected clipboard-fallback log(s) ignored");
  if (relevant.length) { failures += relevant.length; console.log("  -> " + relevant.length + " look Tag Lens / F4-related (counted as failures)"); }
}

console.log("\\n==== F4 result: " + (failures === 0 ? "PASS \\u2705" : "FAIL \\u2717 (" + failures + " issue(s))") + " | " + report.modes.length + " modes checked ====");
ws.close();
process.exit(failures === 0 ? 0 : 1);
