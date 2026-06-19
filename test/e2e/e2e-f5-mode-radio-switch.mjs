import { VAULT } from "../config.mjs";
import { spawn } from "node:child_process";
import fs from "node:fs";

// Regression probe for the "clicking a View mode radio does nothing visible"
// bug: with perspective:"closeup" + viewMode:"bubblesets" (the exact shape of
// the real bug report's vault), clicking the Panorama "Co-occurrence heatmap"
// radio must actually switch the live canvas to heatmap (perspective +
// viewMode + a rendered legend), not just record panoramaMode silently.
const DIR = "/tmp/obs-e2e-f5-radio";
if (!fs.existsSync(DIR)) fs.mkdirSync(DIR, { recursive: true });
fs.writeFileSync(`${DIR}/obsidian.json`, JSON.stringify({ vaults: { dev: { path: VAULT, ts: 1718270000000, open: true } } }));

const obs = spawn("obsidian", [
  VAULT,
  "--user-data-dir=" + DIR,
  "--remote-debugging-port=9233"
], { detached: true, stdio: "ignore" });
process.on("exit", () => { try { process.kill(-obs.pid); } catch (e) {} });

await new Promise(r => setTimeout(r, 3000));
const CDP_URL = "http://127.0.0.1:9233";
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
let nextId = 1;
const pending = new Map();
ws.onmessage = (ev) => { const msg = JSON.parse(ev.data); if (msg.id && pending.has(msg.id)) { pending.get(msg.id)(msg); pending.delete(msg.id); } };
const send = (method, params = {}) => new Promise((resolve) => { const id = nextId++; pending.set(id, resolve); ws.send(JSON.stringify({ id, method, params })); });
await send("Runtime.enable");

const driver = `(async () => {
  const out = {};
  const sleep = (ms) => new Promise(r => setTimeout(r, ms));
  for (let i = 0; i < 40; i++) { if (window.app && window.app.plugins) break; await sleep(250); }
  window.app.plugins.setEnable(true);
  if (!window.app.plugins.plugins["tag-lens"]) await window.app.plugins.enablePluginAndSave("tag-lens");
  let plugin = null;
  for (let i = 0; i < 40; i++) { plugin = window.app.plugins.plugins["tag-lens"]; if (plugin) break; await sleep(250); }
  if (!plugin) { out.fatal = "plugin not loaded"; return out; }
  await plugin.activateView(); await sleep(300);
  const view = window.app.workspace.getLeavesOfType("tag-lens-view")[0].view;
  const snap = { perspective: view.settings.perspective, viewMode: view.settings.viewMode, panoramaMode: view.settings.panoramaMode, closeupMode: view.settings.closeupMode };
  try {
    // Reproduce the bug report's exact starting shape.
    view.settings.perspective = "closeup";
    view.settings.closeupMode = "bubblesets";
    view.settings.viewMode = "bubblesets";
    view.settings.panoramaMode = "heatmap";
    view.settings.showLegend = true;
    view.settings.legendHiddenModes = {};
    await view.rebuild();
    out.before = { perspective: view.settings.perspective, viewMode: view.settings.viewMode };

    // Open the unified menu's Settings > View tab and click the Panorama
    // "Co-occurrence heatmap" radio, exactly as a user would: real DOM
    // button clicks, no private-method calls.
    view.toggleNoteMenu();
    await sleep(250);
    const menuRoot = view.noteMenu;
    if (!menuRoot) { out.fatal2 = "noteMenu not open"; return out; }
    const clickByText = (root, sel, text) => {
      const el = Array.from(root.querySelectorAll(sel)).find(b => b.textContent.trim() === text);
      if (el) el.dispatchEvent(new MouseEvent("click", { bubbles: true }));
      return el;
    };
    if (!clickByText(menuRoot, "button", "Settings")) { out.fatal3 = "Settings tab button not found"; return out; }
    await sleep(150);
    if (!clickByText(menuRoot, "button", "View")) { out.fatal4 = "View sub-tab button not found"; return out; }
    await sleep(150);
    const radios = Array.from(menuRoot.querySelectorAll('input[type=radio][name=gim-viewmode-panorama]'));
    out.radioValues = radios.map(r => r.value);
    const heatmapRadio = radios.find(r => r.value === "heatmap");
    if (!heatmapRadio) { out.fatal5 = "heatmap radio not found"; return out; }
    heatmapRadio.checked = true;
    heatmapRadio.dispatchEvent(new Event("change", { bubbles: true }));
    await sleep(400);

    out.after = { perspective: view.settings.perspective, viewMode: view.settings.viewMode };
    out.legendCloseRect = view.legendCloseRect;
    out.hasLegend = view.legendCloseRect != null;
  } catch (e) {
    out.threw = String(e && e.stack || e);
  } finally {
    view.settings.perspective = snap.perspective;
    view.settings.viewMode = snap.viewMode;
    view.settings.panoramaMode = snap.panoramaMode;
    view.settings.closeupMode = snap.closeupMode;
    await view.rebuild(); view.draw(); await view.save();
  }
  return out;
})()`;

const resp = await send("Runtime.evaluate", { expression: driver, awaitPromise: true, returnByValue: true });
if (resp.result?.exceptionDetails) { console.error("FAIL: driver threw:", JSON.stringify(resp.result.exceptionDetails).slice(0,1000)); process.exit(1); }
const value = resp.result.result.value;
console.log(JSON.stringify(value, null, 2));
ws.close();

const ok = value && value.after && value.after.perspective === "panorama" && value.after.viewMode === "heatmap" && value.hasLegend === true;
console.log(ok ? "PASS ✅" : "FAIL ❌");
process.exit(ok ? 0 : 1);
