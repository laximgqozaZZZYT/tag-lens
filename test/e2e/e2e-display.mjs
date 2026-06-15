import { VAULT } from "../config.mjs";
import { spawn } from "node:child_process";

const obs = spawn("obsidian", [
  VAULT,
  "--user-data-dir=/tmp/obs-e2e-display",
  "--remote-debugging-port=9223"
], { detached: true, stdio: "ignore" });

await new Promise(r => setTimeout(r, 3000));

const CDP_URL = "http://127.0.0.1:9223";

// ---- minimal CDP client over a single page target ----
let list = null;
for (let i = 0; i < 20; i++) {
  try {
    const res = await fetch(`${CDP_URL}/json/list`);
    if (res.ok) {
      list = await res.json();
      break;
    }
  } catch (e) {}
  await new Promise(r => setTimeout(r, 250));
}
if (!list) { console.error("FAIL: fetch failed"); process.exit(1); }

const page = list.find((t) => t.type === "page" && t.webSocketDebuggerUrl && t.url.startsWith("app://obsidian.md"));

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

// ---- the in-renderer driver: cycle all modes, collect a structured report ----
const driver = `(async () => {
  const out = { fatal: null, modes: [] };
  const sleep = (ms) => new Promise(r => setTimeout(r, ms));
  
  // Wait for app
  for (let i = 0; i < 40; i++) { 
    if (window.app && window.app.plugins) break;
    await sleep(250); 
  }

  let plugin = null;
  try {
    window.app.plugins.setEnable(true);
    await window.app.plugins.disablePluginAndSave("tag-lens");
    await sleep(250);
    await window.app.plugins.enablePluginAndSave("tag-lens");
  } catch(e) { out.fatal = "enable err: " + e; return out; }
  for (let i = 0; i < 40; i++) { plugin = window.app.plugins.plugins["tag-lens"]; if (plugin) break; await sleep(250); }
  if (!plugin) { out.fatal = "plugin not loaded."; return out; }
  await plugin.activateView(); await sleep(300);
  const leaf = window.app.workspace.getLeavesOfType("tag-lens-view")[0];
  if (!leaf || !leaf.view) { out.fatal = "no view leaf"; return out; }
  const view = leaf.view;
  const saved = JSON.parse(JSON.stringify(view.settings));
  // Force the overlay-driven branches ON so every mode exercises them.
  view.settings.showMaturity = true;
  const MODES = ["droste","euler","euler-true","euler-venn","bipartite","matrix","bubblesets","heatmap","lattice","upset","stream"];
  for (const m of MODES) {
    const e = { mode: m, rebuild: "ok", draw: "ok", settings: "ok", insight: "ok", toggles: [], sections: [], laidNodes: 0, matDef: 0, encParams: 0, encNodesUnchanged: false };
    try { 
      view.settings.viewMode = m; 
      
      // Verification: encoding ON/OFF preserves node count, and encParams are populated
      view.settings.encoding = [{ channelId: "color", fieldId: "ageDays", enabled: true, scale: { type: "linear" } }];
      await view.rebuild();
      const nodesWithEnc = view.laid.nodes.length;
      const paramsCount = Array.from(view.encParams.values()).filter(p => p.fillColor || p.fillHue).length;
      
      view.settings.encoding = [];
      await view.rebuild();
      const nodesWithoutEnc = view.laid.nodes.length;
      
      e.encNodesUnchanged = (nodesWithEnc === nodesWithoutEnc);
      e.encParams = paramsCount;
      
    } catch (err) { e.rebuild = String(err && err.stack || err); }
    await sleep(40);
    try { view.draw(); } catch (err) { e.draw = String(err && err.stack || err); }
    // REFLECTION: with showMaturity ON, every laid card MUST carry fmMaturity
    // (the parser always computes it). A 0 here = the layout dropped the field
    // = overlay silently broken (the euler-true/venn/bubblesets regression).
    try {
      const ln = (view.laid.nodes || []).filter((n) => !n.id.startsWith("\0"));
      e.laidNodes = ln.length;
      e.matDef = ln.filter((n) => n.fmMaturity != null).length;
    } catch (err) { /* leave zeros */ }
    try {
      const div = document.createElement("div");
      view.renderSettingsDisplay(div);
      e.toggles = Array.from(div.querySelectorAll(".gim-toggle-row")).map(r => (r.textContent||"").trim());
      e.sections = Array.from(div.querySelectorAll("h4")).map(h => (h.textContent||"").trim());
    } catch (err) { e.settings = String(err && err.stack || err); }
    try {
      const div2 = document.createElement("div");
      view.insightSubTab = "alerts";
      view.renderInsightBody(div2);
    } catch (err) { e.insight = String(err && err.stack || err); }
    out.modes.push(e);
  }
  // restore the user's settings (do not persist test mutations)
  Object.assign(view.settings, saved);
  try { view.settings.viewMode = saved.viewMode; await view.rebuild(); view.draw(); } catch (e) {}
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

// ---- expected Display-panel gating (mirror src/display-applicability.ts) ----
const CARD = new Set(["euler", "euler-true", "euler-venn", "bipartite", "bubblesets"]);
const CARD_TOGGLE_LABELS = ["Show nodes", "Show enclosures", "Show edges", "Show grid", "Note maturity badge"];
const has = (arr, label) => arr.some((t) => t.includes(label));
function expectedCardToggles(mode) {
	return new Set(CARD_TOGGLE_LABELS);
}
// All modes must propagate the fields now!
const OVERLAY_MODES = new Set([...CARD, "upset", "matrix", "heatmap", "lattice", "stream", "droste"]);
function expectSection(mode, name) {
	return true;
}

let failures = 0;
const fail = (m, msg) => { failures++; console.log(`  ✗ [${m}] ${msg}`); };

console.log(`\nmode            rebuild draw settings insight  matDef/nodes | encParams | encSafe | card-toggles`);
for (const e of report.modes) {
	const status = (s) => (s === "ok" ? "ok " : "ERR");
	const cardPresent = CARD_TOGGLE_LABELS.filter((l) => has(e.toggles, l));
	console.log(
		`${e.mode.padEnd(14)}  ${status(e.rebuild)}     ${status(e.draw)}  ${status(e.settings)}      ${status(e.insight)}    ${String(e.matDef).padStart(4)}/${String(e.laidNodes).padEnd(4)} | ${String(e.encParams).padStart(9)} | ${e.encNodesUnchanged ? "YES    " : "NO     "} | ${cardPresent.join(", ") || "(none)"}`,
	);
	for (const k of ["rebuild", "draw", "settings", "insight"]) {
		if (e[k] !== "ok") fail(e.mode, `${k} threw: ${String(e[k]).split("\\n")[0].slice(0, 160)}`);
	}
	// REFLECTION: overlay modes with cards must propagate fmMaturity to EVERY
	// laid node (catches layout dropping the field = silent overlay failure).
	if (OVERLAY_MODES.has(e.mode) && e.laidNodes > 0 && e.matDef !== e.laidNodes) {
		fail(e.mode, `fmMaturity propagated to only ${e.matDef}/${e.laidNodes} laid nodes (overlay silently broken)`);
	}
	if (!e.encNodesUnchanged) {
		fail(e.mode, "encoding ON/OFF changed the laid.nodes count (violation of separation of concerns)");
	}
	if (OVERLAY_MODES.has(e.mode) && e.laidNodes > 0 && e.encParams === 0) {
		fail(e.mode, "color binding produced no encParams.fillColor");
	}
	// card-toggle gating
	const exp = expectedCardToggles(e.mode);
	for (const label of CARD_TOGGLE_LABELS) {
		const present = has(e.toggles, label);
		if (present && !exp.has(label)) fail(e.mode, `toggle "${label}" shown but should be hidden`);
		if (!present && exp.has(label)) fail(e.mode, `toggle "${label}" missing but should be shown`);
	}
	// section gating
	for (const name of ["Graph display", "Bridge finder"]) {
		const want = expectSection(e.mode, name);
		if (want === null) continue;
		const got = e.sections.some((s) => s.includes(name));
		if (want && !got) fail(e.mode, `section "${name}" missing`);
		if (!want && got) fail(e.mode, `section "${name}" present but should be hidden`);
	}
}

if (consoleErrors.length) {
	console.log(`\nconsole errors captured (${consoleErrors.length}):`);
	for (const c of consoleErrors.slice(0, 20)) console.log("  ! " + c.slice(0, 200));
	// 404 favicon and unrelated noise shouldn't fail the run; tag-lens errors should.
	const relevant = consoleErrors.filter((c) => /tag-lens|MiniGraphView|view\.ts|draw-|stream|laid|canvas/i.test(c));
	if (relevant.length) { failures += relevant.length; console.log(`  -> ${relevant.length} look Tag Lens-related (counted as failures)`); }
}

console.log("\\n==== E2E result: " + (failures === 0 ? "PASS ✅" : "FAIL ✗ (" + failures + " issue(s))") + " | " + report.modes.length + " modes checked ====");
ws.close();
process.exit(failures === 0 ? 0 : 1);
