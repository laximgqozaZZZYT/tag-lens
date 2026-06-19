import { VAULT } from "../config.mjs";
import { spawn } from "node:child_process";
import fs from "node:fs";

// Regression probe for: "Panorama no longer shows the whole vault after
// switching back from Close-up (via the View mode radio) or after a reload."
//
// Root cause: switchToCloseup() (view.ts) sets settings.focusNodeIds to the
// closeup subset of note ids; buildGraph() (called from rebuild()) filters
// the graph to focusNodeIds whenever it is set, REGARDLESS of perspective.
// The toolbar "Return to Panorama" button (switchToPanorama()) clears
// focusNodeIds, but the View-mode radio handler added in
// settings-sections.ts (renderViewModeOption's `change` listener) only
// flipped `perspective`/`viewMode`/`panoramaMode` and never cleared
// focusNodeIds — so Panorama rendered filtered to the stale closeup subset
// (and stayed that way across reload, since focusNodeIds is persisted via
// saveData(this.settings)).
const DIR = "/tmp/obs-e2e-f5-panorama-restore";
if (!fs.existsSync(DIR)) fs.mkdirSync(DIR, { recursive: true });
fs.writeFileSync(`${DIR}/obsidian.json`, JSON.stringify({ vaults: { dev: { path: VAULT, ts: 1718270000000, open: true } } }));

const PORT = 9234;
const obs = spawn("obsidian", [
  VAULT,
  "--user-data-dir=" + DIR,
  `--remote-debugging-port=${PORT}`
], { detached: true, stdio: "ignore" });
process.on("exit", () => { try { process.kill(-obs.pid); } catch (e) {} });

await new Promise(r => setTimeout(r, 3000));
const CDP_URL = `http://127.0.0.1:${PORT}`;
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
  const snap = JSON.parse(JSON.stringify(view.settings));
  try {
    // 1) Establish vault-wide ground truth in BOTH perspectives, with NO
    // focus filter: Panorama/heatmap's tag count, and Close-up/droste's
    // gallery cell count (the note-level grid for that mode).
    view.settings.perspective = "panorama";
    view.settings.panoramaMode = "heatmap";
    view.settings.viewMode = "heatmap";
    delete view.settings.focusNodeIds;
    await view.rebuild(); await sleep(200);
    out.vaultWideHeatmapTagCount = (view.laid.heatmap && view.laid.heatmap.tags) ? view.laid.heatmap.tags.length : null;

    view.settings.perspective = "closeup";
    view.settings.closeupMode = "droste";
    view.settings.viewMode = "droste";
    await view.rebuild(); await sleep(200);
    const gallery = view.laid.drosteGallery;
    const allCellIds = gallery ? gallery.cells.map(c => c.id) : [];
    out.vaultWideDrosteCellCount = allCellIds.length;
    if (!out.vaultWideHeatmapTagCount || !out.vaultWideDrosteCellCount) {
      out.fatalBaseline = "vault baseline is empty — fixture vault has no data";
      return out;
    }

    // 2) Drill into Close-up on a small subset (simulating a real click on a
    // heatmap cell / lattice node), exactly like switchToCloseup() does.
    const subset = allCellIds.slice(0, Math.max(1, Math.min(2, allCellIds.length)));
    view.switchToCloseup(subset);
    await sleep(200);
    out.afterCloseup = {
      perspective: view.settings.perspective,
      focusNodeIds: view.settings.focusNodeIds,
      drosteCellCount: view.laid.drosteGallery ? view.laid.drosteGallery.cells.length : null,
    };

    // 3) Return to Panorama via the View-mode RADIO (not the toolbar button)
    // — open Settings > View, click the Panorama "Co-occurrence heatmap"
    // radio, exactly as a user would. Force-open (don't blindly toggle):
    // noteMenuVisible may already be true from a prior run sharing this
    // profile's data.json, in which case a toggle would CLOSE it instead.
    if (!view.settings.noteMenuVisible) view.toggleNoteMenu();
    await sleep(300);
    let menuRoot = view.noteMenu;
    if (!menuRoot) { view.toggleNoteMenu(); await sleep(150); view.toggleNoteMenu(); await sleep(300); menuRoot = view.noteMenu; }
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
    const heatmapRadio = radios.find(r => r.value === "heatmap");
    if (!heatmapRadio) { out.fatal5 = "heatmap radio not found"; return out; }
    heatmapRadio.checked = true;
    heatmapRadio.dispatchEvent(new Event("change", { bubbles: true }));
    await sleep(400);

    out.afterRadioToPanorama = {
      perspective: view.settings.perspective,
      viewMode: view.settings.viewMode,
      focusNodeIds: view.settings.focusNodeIds ?? null,
      heatmapTagCount: (view.laid.heatmap && view.laid.heatmap.tags) ? view.laid.heatmap.tags.length : null,
    };

    // 4) Simulate a reload: persist settings (as the radio handler's
    // deps.save() already did), then rebuild fresh from that persisted
    // settings shape only — mirroring what onload() + activateView() would
    // reconstruct after an actual Obsidian reload.
    await view.save();
    const persisted = JSON.parse(JSON.stringify(view.settings));
    out.persistedFocusNodeIds = persisted.focusNodeIds ?? null;
    await view.rebuild(); await sleep(200);
    out.afterSimulatedReload = {
      perspective: view.settings.perspective,
      heatmapTagCount: (view.laid.heatmap && view.laid.heatmap.tags) ? view.laid.heatmap.tags.length : null,
    };

    // 5) Also confirm the underlying note set is whole-vault, not just the
    // tag count: flip to Close-up/droste (still without ever re-setting
    // focusNodeIds ourselves) and compare cell count to the step-1 baseline.
    view.settings.perspective = "closeup";
    view.settings.closeupMode = "droste";
    view.settings.viewMode = "droste";
    await view.rebuild(); await sleep(200);
    out.afterReloadDrosteCellCount = view.laid.drosteGallery ? view.laid.drosteGallery.cells.length : null;
  } catch (e) {
    out.threw = String(e && e.stack || e);
  } finally {
    Object.assign(view.settings, snap);
    if (snap.focusNodeIds === undefined) delete view.settings.focusNodeIds;
    await view.rebuild(); view.draw(); await view.save();
  }
  return out;
})()`;

const resp = await send("Runtime.evaluate", { expression: driver, awaitPromise: true, returnByValue: true });
if (resp.result?.exceptionDetails) { console.error("FAIL: driver threw:", JSON.stringify(resp.result.exceptionDetails).slice(0,1000)); process.exit(1); }
const value = resp.result.result.value;
console.log(JSON.stringify(value, null, 2));
ws.close();

const ok = value
  && !value.fatalBaseline
  && value.afterRadioToPanorama
  && value.afterRadioToPanorama.perspective === "panorama"
  && value.afterRadioToPanorama.viewMode === "heatmap"
  && value.afterRadioToPanorama.focusNodeIds === null
  && value.vaultWideHeatmapTagCount != null
  && value.afterRadioToPanorama.heatmapTagCount === value.vaultWideHeatmapTagCount
  && value.persistedFocusNodeIds === null
  && value.afterSimulatedReload
  && value.afterSimulatedReload.perspective === "panorama"
  && value.afterSimulatedReload.heatmapTagCount === value.vaultWideHeatmapTagCount
  && value.vaultWideDrosteCellCount != null
  && value.afterReloadDrosteCellCount === value.vaultWideDrosteCellCount;
console.log(ok ? "PASS ✅" : "FAIL ❌");
process.exit(ok ? 0 : 1);
