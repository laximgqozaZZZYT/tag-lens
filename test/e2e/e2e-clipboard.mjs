import { VAULT } from "../config.mjs";
import { spawn } from "node:child_process";
import fs from "node:fs";

// Clipboard image-copy (PNG) E2E. Mirrors e2e-display.mjs / e2e-f1-json.mjs but on
// a DEDICATED profile + DEDICATED port so the user's running Obsidian (profile
// ~/.config/obsidian, port 9222) is NEVER touched. We pre-register the dev vault
// (open:true) in this fresh profile so Obsidian boots straight into it.
//
// Verifies src/panel/export-image.ts copyBlobToClipboard via view.exportImage():
//   1. capability    — typeof window.ClipboardItem / navigator.clipboard.write
//   2. spy           — stub clipboard.write, run export, assert it receives ONE
//                      [ClipboardItem] whose "image/png" Blob starts with the PNG
//                      magic bytes and is >100 bytes.
//   3. real-path     — un-stubbed export; record the Notice ("copied to clipboard"
//                      success OR "saving to vault instead" fallback) — either is a
//                      non-broken outcome (CDP eval lacks a user gesture so the real
//                      clipboard.write may reject → robust fallback expected).
//   4. vault cleanup — any NEW tag-lens-*.png produced by the fallback is deleted;
//                      final delta must be 0 (leave the dev vault untouched).
const DIR = "/tmp/obs-e2e-clip";
if (!fs.existsSync(DIR)) fs.mkdirSync(DIR, { recursive: true });
fs.writeFileSync(`${DIR}/obsidian.json`, JSON.stringify({ vaults: { dev: { path: VAULT, ts: 1718270000000, open: true } } }));

const obs = spawn("obsidian", [
  VAULT,
  "--user-data-dir=" + DIR,
  "--remote-debugging-port=9227"
], { detached: true, stdio: "ignore" });

// Kill the detached Obsidian process GROUP on exit so the instance never leaks
// (it holds port 9227 and blocks the next run otherwise).
process.on("exit", () => { try { process.kill(-obs.pid); } catch (e) {} });

await new Promise(r => setTimeout(r, 3000));

const CDP_URL = "http://127.0.0.1:9227";

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

// ---- in-renderer driver: exercise the clipboard copy path, collect a report ----
const driver = `(async () => {
  const out = { fatal: null, capability: {}, spy: {}, realPath: {}, vault: {} };
  const sleep = (ms) => new Promise(r => setTimeout(r, ms));
  const PNG_MAGIC = [137,80,78,71,13,10,26,10];

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

  // Make sure there's something to draw.
  try { await view.rebuild(); view.draw(); await sleep(100); } catch (e) {}

  // ── vault baseline: existing tag-lens-*.png files ───────────────────────────
  const pngBefore = window.app.vault.getFiles()
    .filter(f => f.path.split("/").pop().startsWith("tag-lens-") && f.path.endsWith(".png"))
    .map(f => f.path);
  out.vault.before = pngBefore;

  // ── 1) capability ───────────────────────────────────────────────────────────
  out.capability.ClipboardItem = typeof window.ClipboardItem;
  out.capability.clipboardWrite = typeof (navigator.clipboard && navigator.clipboard.write);

  // ── 2) spy verification ─────────────────────────────────────────────────────
  // Stub navigator.clipboard.write to capture its arg and resolve. ClipboardItem
  // stays real, so we exercise the genuine ClipboardItem({"image/png": blob}) path.
  try {
    if (typeof window.ClipboardItem !== "function" || typeof (navigator.clipboard && navigator.clipboard.write) !== "function") {
      out.spy = { pass: false, why: "capability missing (cannot spy real path)", skipped: true };
    } else {
      let calls = 0;
      let captured = null;
      const orig = navigator.clipboard.write;
      const stub = function (data) { calls++; captured = data; return Promise.resolve(); };
      // navigator.clipboard.write may be non-writable; define via the clipboard obj.
      Object.defineProperty(navigator.clipboard, "write", { value: stub, configurable: true, writable: true });
      try {
        await view.exportImage({ scale: 2, fit: false, target: "clipboard" });
      } finally {
        Object.defineProperty(navigator.clipboard, "write", { value: orig, configurable: true, writable: true });
      }
      // Inspect the captured argument.
      const s = { calls };
      s.isArray = Array.isArray(captured);
      const item = s.isArray ? captured[0] : null;
      s.isClipboardItem = !!item && (item instanceof window.ClipboardItem);
      let magicOk = false, size = 0, magic = null;
      if (item && typeof item.getType === "function") {
        const blob = await item.getType("image/png");
        size = blob ? blob.size : 0;
        const buf = blob ? await blob.arrayBuffer() : new ArrayBuffer(0);
        const head = Array.from(new Uint8Array(buf).slice(0, 8));
        magic = head;
        magicOk = head.length === 8 && PNG_MAGIC.every((b, i) => head[i] === b);
      }
      s.size = size;
      s.magic = magic;
      s.magicOk = magicOk;
      s.pass = (calls === 1 && s.isArray && s.isClipboardItem && magicOk && size > 100);
      out.spy = s;
    }
  } catch (e) {
    out.spy = { pass: false, why: "spy threw: " + (e && e.stack || e) };
  }

  // ── 3) real-path verification (no stub; capture resulting Notice) ────────────
  // Clear any visible notices first so we read only the new one.
  try {
    document.querySelectorAll(".notice").forEach(n => n.remove());
    await view.exportImage({ scale: 2, fit: false, target: "clipboard" });
    await sleep(200);
    const noticeTexts = Array.from(document.querySelectorAll(".notice")).map(n => (n.textContent||"").trim());
    out.realPath.notices = noticeTexts;
    const joined = noticeTexts.join(" | ");
    const copied = /copied to clipboard/i.test(joined);
    const fallbackSave = /saving to vault instead|image saved to/i.test(joined);
    out.realPath.copied = copied;
    out.realPath.fallback = fallbackSave;
    // "Not broken" = either the success Notice or a clean fallback Notice appeared.
    out.realPath.pass = copied || fallbackSave;
    out.realPath.outcome = copied ? "clipboard-success" : (fallbackSave ? "vault-fallback" : "no-notice");
  } catch (e) {
    out.realPath = { pass: false, why: "real export threw: " + (e && e.stack || e) };
  }

  // ── 4) vault cleanup: delete any NEW tag-lens-*.png (fallback artifacts) ─────
  try {
    await sleep(150);
    const beforeSet = new Set(pngBefore);
    const pngAfter = window.app.vault.getFiles()
      .filter(f => f.path.split("/").pop().startsWith("tag-lens-") && f.path.endsWith(".png"))
      .map(f => f.path);
    const added = pngAfter.filter(p => !beforeSet.has(p));
    out.vault.addedDuringTest = added.slice();
    const deleted = [];
    for (const p of added) {
      const file = window.app.vault.getAbstractFileByPath(p);
      if (file) { await window.app.vault.delete(file); deleted.push(p); }
    }
    out.vault.deleted = deleted;
    // Recount to confirm delta 0.
    const pngFinal = window.app.vault.getFiles()
      .filter(f => f.path.split("/").pop().startsWith("tag-lens-") && f.path.endsWith(".png"))
      .map(f => f.path);
    out.vault.finalAdded = pngFinal.filter(p => !beforeSet.has(p));
    out.vault.delta0 = out.vault.finalAdded.length === 0;
  } catch (e) {
    out.vault.cleanupError = "cleanup threw: " + (e && e.stack || e);
    out.vault.delta0 = false;
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
console.log("\\n==== Clipboard image-copy (PNG) E2E ====\\n");

// capability
console.log("capability:");
console.log("  window.ClipboardItem        : " + report.capability.ClipboardItem);
console.log("  navigator.clipboard.write   : " + report.capability.clipboardWrite);

// spy
console.log("\\nspy verification (stubbed clipboard.write):");
const spy = report.spy || {};
if (spy.skipped) {
  console.log("  SKIPPED — " + spy.why);
  failures++; // a real Obsidian electron renderer is expected to expose both APIs
} else {
  console.log("  write calls                 : " + spy.calls);
  console.log("  arg is Array                : " + spy.isArray);
  console.log("  arg[0] instanceof ClipboardItem: " + spy.isClipboardItem);
  console.log("  blob size (bytes)           : " + spy.size);
  console.log("  PNG magic head              : " + JSON.stringify(spy.magic));
  console.log("  PNG magic match             : " + spy.magicOk);
  console.log("  -> " + (spy.pass ? "PASS \\u2705" : "FAIL \\u2717 " + (spy.why || "")));
  if (!spy.pass) failures++;
}

// real-path
console.log("\\nreal-path verification (un-stubbed export):");
const rp = report.realPath || {};
console.log("  notices                     : " + JSON.stringify(rp.notices || []));
console.log("  outcome                     : " + (rp.outcome || "n/a"));
console.log("  -> " + (rp.pass ? "PASS \\u2705 (clipboard copy feature not broken)" : "FAIL \\u2717 " + (rp.why || "no recognizable Notice")));
if (!rp.pass) failures++;

// vault
console.log("\\nvault restoration:");
const v = report.vault || {};
console.log("  png before                  : " + (v.before ? v.before.length : "?"));
console.log("  png added during test       : " + JSON.stringify(v.addedDuringTest || []));
console.log("  png deleted (cleanup)       : " + JSON.stringify(v.deleted || []));
console.log("  final delta vs baseline     : " + (v.finalAdded ? v.finalAdded.length : "?"));
if (v.cleanupError) console.log("  cleanup error               : " + v.cleanupError);
console.log("  -> " + (v.delta0 ? "PASS \\u2705 (vault restored, delta 0)" : "FAIL \\u2717 (vault NOT restored)"));
if (!v.delta0) failures++;

if (consoleErrors.length) {
  console.log(`\\nconsole errors captured (${consoleErrors.length}):`);
  for (const c of consoleErrors.slice(0, 20)) console.log("  ! " + c.slice(0, 200));
  const relevant = consoleErrors.filter((c) => /tag-lens|clipboard|exportImage|copyBlob|saveBlob|toBlob|ClipboardItem/i.test(c));
  if (relevant.length) { failures += relevant.length; console.log(`  -> ${relevant.length} look Tag Lens / clipboard-related (counted as failures)`); }
}

console.log("\\n==== Clipboard E2E result: " + (failures === 0 ? "PASS \\u2705" : "FAIL \\u2717 (" + failures + " issue(s))") + " ====");
ws.close();
process.exit(failures === 0 ? 0 : 1);
