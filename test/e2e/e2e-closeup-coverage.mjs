import { VAULT } from "../config.mjs";
import { spawn } from "node:child_process";

const obs = spawn("obsidian", [
  VAULT,
  "--user-data-dir=/tmp/obs-e2e-closeup-cov",
  "--remote-debugging-port=9225"
], { detached: true, stdio: "ignore" });

await new Promise(r => setTimeout(r, 4000));

const CDP_URL = "http://127.0.0.1:9225";

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

let msgId = 1;
const req = (method, params = {}) => new Promise((resolve) => {
  const id = msgId++;
  const handler = (msg) => {
    const data = JSON.parse(msg.data);
    if (data.id === id) {
      ws.removeEventListener("message", handler);
      resolve(data.result);
    }
  };
  ws.addEventListener("message", handler);
  ws.send(JSON.stringify({ id, method, params }));
});

await req("Runtime.enable");
await req("Log.enable");

const evs = [];
ws.addEventListener("message", (msg) => {
  const data = JSON.parse(msg.data);
  if (data.method === "Runtime.exceptionThrown") {
    evs.push("Exception: " + data.params.exceptionDetails.exception.description);
  }
});

const driver = `(async () => {
  const out = { fatal: null, modes: [] };
  const sleep = (ms) => new Promise(r => setTimeout(r, ms));
  
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
  } catch(e) { out.fatal = "enable err: " + String(e); return out; }
  for (let i = 0; i < 40; i++) { plugin = window.app.plugins.plugins["tag-lens"]; if (plugin) break; await sleep(250); }
  if (!plugin) { out.fatal = "plugin not loaded."; return out; }
  await plugin.activateView(); await sleep(300);
  const leaf = window.app.workspace.getLeavesOfType("tag-lens-view")[0];
  if (!leaf || !leaf.view) { out.fatal = "no view leaf"; return out; }
  const view = leaf.view;
  
  const MODES = ["droste","euler","bipartite","matrix","heatmap","lattice","stream"];
  for (const m of MODES) {
    const e = { mode: m, switchError: null, restoreError: null };
    try {
      view.settings.viewMode = m;
      await view.rebuild();
      
      try {
        view.switchToCloseup([]);
      } catch (err) { e.switchError = String(err && err.stack ? err.stack : err); }
      
      try {
        view.switchToPanorama();
      } catch (err) { e.restoreError = String(err && err.stack ? err.stack : err); }

    } catch (err) {
      e.switchError = "Setup error: " + String(err && err.stack ? err.stack : err);
    }
    out.modes.push(e);
  }
  return out;
})()`;

const evaluatePromise = req("Runtime.evaluate", { expression: driver, awaitPromise: true, returnByValue: true });
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
  console.error("FAIL: driver threw:", JSON.stringify(resp.result.exceptionDetails));
  process.exit(1);
}

const report = resp.result.result.value;

if (!report) {
	console.error("FAIL: Driver fatal:", JSON.stringify(resp.result));
	process.exit(1);
} else if (report.fatal) {
	console.error("FAIL: Driver fatal:", report.fatal);
	process.exit(1);
}

let failures = 0;
for (const m of report.modes) {
  if (m.switchError) { console.error("[" + m.mode + "] switchToCloseup threw: " + m.switchError); failures++; }
  if (m.restoreError) { console.error("[" + m.mode + "] switchToPanorama threw: " + m.restoreError); failures++; }
}
if (evs.length) {
    console.error("Uncaught exceptions:", evs);
    failures++;
}
if (failures === 0) console.log("All closeup transitions passed.");

try { process.kill(-obs.pid); } catch(e){}
ws.close();
process.exit(failures > 0 ? 1 : 0);
