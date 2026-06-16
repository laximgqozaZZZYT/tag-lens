import { VAULT } from "../config.mjs";
import { spawn } from "node:child_process";
import fs from "node:fs";

// F3 = SVG export E2E. Verifies view.exportSvg({ fit, target }) on real Obsidian:
// the SvgRecorderContext (src/visual/svg-recorder.ts) swaps in for this.ctx, the
// existing per-mode draw() replays into it, and rec.toSvg() yields a pure-vector
// SVG string copied to clipboard or saved to vault.
//
//   1. all-11-modes — stub navigator.clipboard.write (ClipboardItem/Blob stay
//                     REAL); for each mode rebuild()+draw()+exportSvg(clipboard),
//                     pull the image/svg+xml Blob back out, and assert it is a
//                     well-formed SVG (DOMParser, no parsererror), viewBox matches
//                     canvas W/H, and it carries >0 drawn elements.
//   2. real-path   — un-stubbed clipboard export once (euler); record the Notice
//                     (success / text fallback / vault fallback — all non-broken).
//   3. vault-path  — exportSvg(vault) once; assert exactly one NEW tag-lens-*.svg
//                     was created, its content is a well-formed SVG, then DELETE it.
//   4. restore     — view.draw() runs clean afterwards (ctx/canvas back to live).
//   5. vault clean — every .svg created during the run is removed; final delta 0.
//
// SAFETY: DEDICATED profile /tmp/obs-e2e-svg + DEDICATED port 9228 so the user's
// running Obsidian (profile ~/.config/obsidian, default port) is NEVER touched.
const DIR = "/tmp/obs-e2e-svg";
if (!fs.existsSync(DIR)) fs.mkdirSync(DIR, { recursive: true });
fs.writeFileSync(`${DIR}/obsidian.json`, JSON.stringify({ vaults: { dev: { path: VAULT, ts: 1718270000000, open: true } } }));

const obs = spawn("obsidian", [
  VAULT,
  "--user-data-dir=" + DIR,
  "--remote-debugging-port=9228"
], { detached: true, stdio: "ignore" });

// Kill the detached Obsidian process GROUP on exit so the instance never leaks
// (it holds port 9228 and blocks the next run otherwise).
process.on("exit", () => { try { process.kill(-obs.pid); } catch (e) {} });

await new Promise(r => setTimeout(r, 3000));

const CDP_URL = "http://127.0.0.1:9228";

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

// ---- in-renderer driver: exercise SVG export across all modes + real paths ----
const driver = `(async () => {
  const out = { fatal: null, modes: [], realPath: {}, vaultPath: {}, restore: {}, vault: {} };
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
  const saved = JSON.parse(JSON.stringify(view.settings));

  // ── vault baseline: existing tag-lens-*.svg files ───────────────────────────
  const svgPaths = () => window.app.vault.getFiles()
    .filter(f => f.path.split("/").pop().startsWith("tag-lens-") && f.path.endsWith(".svg"))
    .map(f => f.path);
  const svgBefore = svgPaths();
  out.vault.before = svgBefore;
  const beforeSet = new Set(svgBefore);

  // Well-formedness checker shared by mode loop + vault path.
  const checkSvg = (svg, expW, expH) => {
    const r = { ok: false };
    if (typeof svg !== "string" || svg.length === 0) { r.why = "empty/non-string svg"; return r; }
    r.startsOk = svg.startsWith("<svg ");
    r.endsOk = svg.trim().endsWith("</svg>");
    const expectVB = "viewBox=\\"0 0 " + expW + " " + expH + "\\"";
    r.viewBoxOk = svg.includes(expectVB);
    let doc = null, parserErr = true, rootSvg = false;
    try {
      doc = new DOMParser().parseFromString(svg, "image/svg+xml");
      parserErr = !!doc.querySelector("parsererror");
      rootSvg = doc.documentElement && doc.documentElement.nodeName === "svg";
    } catch (e) { r.parseThrew = String(e); }
    r.wellFormed = !parserErr;
    r.rootSvg = rootSvg;
    r.elemCount = doc ? doc.querySelectorAll("path,text,rect,g").length : 0;
    r.elemsOk = r.elemCount > 0;
    r.ok = r.startsOk && r.endsOk && r.viewBoxOk && r.wellFormed && r.rootSvg && r.elemsOk;
    return r;
  };

  // ── 1) all 11 modes via stubbed clipboard.write (ClipboardItem/Blob real) ────
  const MODES = ["droste","euler","euler-true","euler-venn","bipartite","matrix","bubblesets","heatmap","lattice","upset","stream"];
  let captured = null;
  const origWrite = navigator.clipboard && navigator.clipboard.write;
  const stub = function (data) { captured = data; return Promise.resolve(); };
  let stubbed = false;
  try {
    if (typeof origWrite === "function") {
      Object.defineProperty(navigator.clipboard, "write", { value: stub, configurable: true, writable: true });
      stubbed = true;
    }
    for (const m of MODES) {
      const e = { mode: m };
      try {
        captured = null;
        view.settings.viewMode = m;
        await view.rebuild();
        view.draw();
        await sleep(30);
        await view.exportSvg({ fit: false, target: "clipboard" });
        e.canvasW = view.canvas.width;
        e.canvasH = view.canvas.height;
        // Pull the SVG back out of the captured ClipboardItem.
        let svg = null;
        const item = Array.isArray(captured) ? captured[0] : null;
        e.gotClipboardItem = !!item && (item instanceof window.ClipboardItem);
        if (item && typeof item.getType === "function") {
          const blob = await item.getType("image/svg+xml");
          svg = blob ? await blob.text() : null;
        }
        if (svg == null) {
          // No clipboard capture: clipboard.write may have been bypassed (fallback).
          // That is a FAIL for this mode's spy path — record why.
          e.check = { ok: false, why: "no image/svg+xml captured from clipboard.write" };
        } else {
          e.svgLen = svg.length;
          e.check = checkSvg(svg, e.canvasW, e.canvasH);
        }
      } catch (err) {
        e.check = { ok: false, why: "export threw: " + String(err && err.stack || err) };
      }
      e.pass = !!(e.check && e.check.ok);
      out.modes.push(e);
    }
  } finally {
    if (stubbed) Object.defineProperty(navigator.clipboard, "write", { value: origWrite, configurable: true, writable: true });
  }

  // ── 2) real-path: un-stubbed clipboard export once (euler) ───────────────────
  try {
    document.querySelectorAll(".notice").forEach(n => n.remove());
    view.settings.viewMode = "euler";
    await view.rebuild();
    view.draw();
    await sleep(30);
    await view.exportSvg({ fit: false, target: "clipboard" });
    await sleep(200);
    const notices = Array.from(document.querySelectorAll(".notice")).map(n => (n.textContent||"").trim());
    out.realPath.notices = notices;
    const joined = notices.join(" | ");
    const copied = /SVG copied to clipboard/i.test(joined);
    const textCopy = /SVG markup copied to clipboard \\(text\\)/i.test(joined);
    const vaultFallback = /clipboard unavailable .* saving SVG to vault instead|SVG saved to/i.test(joined);
    out.realPath.outcome = copied ? "clipboard-svg" : (textCopy ? "clipboard-text" : (vaultFallback ? "vault-fallback" : "no-notice"));
    // Completing without throwing is PASS; any recognized notice confirms a path.
    out.realPath.pass = (copied || textCopy || vaultFallback);
  } catch (e) {
    out.realPath = { pass: false, why: "real export threw: " + (e && e.stack || e) };
  }

  // ── 3) vault path: exportSvg(vault) once; verify + delete ────────────────────
  try {
    const preVault = new Set(svgPaths());
    view.settings.viewMode = "euler";
    await view.rebuild();
    view.draw();
    await sleep(30);
    await view.exportSvg({ fit: false, target: "vault" });
    await sleep(250);
    const added = svgPaths().filter(p => !preVault.has(p));
    out.vaultPath.added = added.slice();
    out.vaultPath.createdOne = added.length === 1;
    if (added.length >= 1) {
      const file = window.app.vault.getAbstractFileByPath(added[0]);
      const content = file ? await window.app.vault.read(file) : "";
      const chk = checkSvg(content, view.canvas.width, view.canvas.height);
      out.vaultPath.wellFormed = chk.wellFormed && chk.rootSvg && chk.startsOk && chk.endsOk && chk.elemsOk;
      out.vaultPath.check = chk;
    } else {
      out.vaultPath.wellFormed = false;
    }
    out.vaultPath.pass = out.vaultPath.createdOne && out.vaultPath.wellFormed;
  } catch (e) {
    out.vaultPath = { pass: false, why: "vault export threw: " + (e && e.stack || e) };
  }

  // ── 4) restore: live draw() works after ctx/canvas swap-back ─────────────────
  try {
    view.draw();
    await sleep(30);
    out.restore.pass = true;
  } catch (e) {
    out.restore = { pass: false, why: "draw after export threw: " + (e && e.stack || e) };
  }

  // ── 5) vault cleanup: delete every NEW tag-lens-*.svg, confirm delta 0 ───────
  try {
    const added = svgPaths().filter(p => !beforeSet.has(p));
    out.vault.addedDuringTest = added.slice();
    const deleted = [];
    for (const p of added) {
      const file = window.app.vault.getAbstractFileByPath(p);
      if (file) { await window.app.vault.delete(file); deleted.push(p); }
    }
    out.vault.deleted = deleted;
    await sleep(100);
    const finalAdded = svgPaths().filter(p => !beforeSet.has(p));
    out.vault.finalAdded = finalAdded;
    out.vault.delta0 = finalAdded.length === 0;
  } catch (e) {
    out.vault.cleanupError = "cleanup threw: " + (e && e.stack || e);
    out.vault.delta0 = false;
  }

  // restore user's settings (do not persist test mutations)
  try { Object.assign(view.settings, saved); view.settings.viewMode = saved.viewMode; await view.rebuild(); view.draw(); } catch (e) {}

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
console.log("\\n==== F3 SVG export E2E ====\\n");

// 1) per-mode table
console.log("mode            svgLen  startEnd viewBox  wellFormed elems(>0)  -> result");
for (const e of report.modes) {
  const c = e.check || {};
  const yn = (b) => (b ? "yes" : "NO ");
  const startEnd = (c.startsOk && c.endsOk);
  console.log(
    e.mode.padEnd(14) + "  " +
    String(e.svgLen ?? "-").padStart(6) + "  " +
    yn(startEnd).padEnd(8) + " " +
    yn(c.viewBoxOk).padEnd(8) + " " +
    yn(c.wellFormed).padEnd(10) + " " +
    (String(c.elemCount ?? "-") + (c.elemsOk ? "" : "!")).padEnd(10) + " -> " +
    (e.pass ? "PASS \\u2705" : "FAIL \\u2717 " + (c.why || [
      !startEnd ? "start/end" : null,
      !c.viewBoxOk ? "viewBox mismatch" : null,
      !c.wellFormed ? "malformed XML" : null,
      !c.elemsOk ? "no elements" : null,
    ].filter(Boolean).join(", ")))
  );
  if (!e.pass) failures++;
}

// 2) real-path
console.log("\\nreal-path (un-stubbed clipboard export, euler):");
const rp = report.realPath || {};
console.log("  notices : " + JSON.stringify(rp.notices || []));
console.log("  outcome : " + (rp.outcome || "n/a"));
console.log("  -> " + (rp.pass ? "PASS \\u2705 (completed via a recognized path)" : "FAIL \\u2717 " + (rp.why || "no recognizable Notice")));
if (!rp.pass) failures++;

// 3) vault path
console.log("\\nvault save path (exportSvg target=vault):");
const vp = report.vaultPath || {};
console.log("  created      : " + JSON.stringify(vp.added || []) + (vp.createdOne ? " (exactly one)" : " (NOT exactly one)"));
console.log("  well-formed  : " + (vp.wellFormed ? "yes" : "NO"));
console.log("  -> " + (vp.pass ? "PASS \\u2705 (create -> well-formed -> delete)" : "FAIL \\u2717 " + (vp.why || "")));
if (!vp.pass) failures++;

// 4) restore
console.log("\\nlive restore (draw() after export):");
const rs = report.restore || {};
console.log("  -> " + (rs.pass ? "PASS \\u2705 (ctx/canvas back to live)" : "FAIL \\u2717 " + (rs.why || "")));
if (!rs.pass) failures++;

// 5) vault restoration
console.log("\\nvault restoration (delta 0):");
const v = report.vault || {};
console.log("  svg before              : " + (v.before ? v.before.length : "?"));
console.log("  svg added during test   : " + JSON.stringify(v.addedDuringTest || []));
console.log("  svg deleted (cleanup)   : " + JSON.stringify(v.deleted || []));
console.log("  final delta vs baseline : " + (v.finalAdded ? v.finalAdded.length : "?"));
if (v.cleanupError) console.log("  cleanup error           : " + v.cleanupError);
console.log("  -> " + (v.delta0 ? "PASS \\u2705 (vault restored, delta 0)" : "FAIL \\u2717 (vault NOT restored)"));
if (!v.delta0) failures++;

// console errors. The real-path test (step 2) runs clipboard.write un-stubbed and
// CDP eval lacks a user gesture, so clipboard.write rejects with
// "Document is not focused" — this is the EXPECTED, handled trigger for the
// writeText fallback (which then succeeds). It is benign, not a defect, so it is
// excluded from the failure count.
if (consoleErrors.length) {
  console.log(`\\nconsole errors captured (${consoleErrors.length}):`);
  for (const c of consoleErrors.slice(0, 20)) console.log("  ! " + c.slice(0, 200));
  const benignFallback = (c) =>
    /clipboard\\.write failed, trying writeText/i.test(c) &&
    /Document is not focused|NotAllowedError/i.test(c);
  const relevant = consoleErrors.filter(
    (c) => /tag-lens|svg|SvgRecorder|exportSvg|toSvg|copySvg|saveSvg|ClipboardItem/i.test(c) && !benignFallback(c),
  );
  const benign = consoleErrors.filter(benignFallback).length;
  if (benign) console.log(`  (i) ${benign} expected clipboard-fallback log(s) ignored — un-stubbed write w/o user gesture)`);
  if (relevant.length) { failures += relevant.length; console.log(`  -> ${relevant.length} look Tag Lens / SVG-related (counted as failures)`); }
}

console.log("\\n==== F3 SVG export E2E result: " + (failures === 0 ? "PASS \\u2705" : "FAIL \\u2717 (" + failures + " issue(s))") + " | " + report.modes.length + " modes checked ====");
ws.close();
process.exit(failures === 0 ? 0 : 1);
