import { VAULT } from "../config.mjs";
import { spawn } from "node:child_process";

const obs = spawn("obsidian", [
  VAULT,
  "--user-data-dir=/tmp/obs-e2e-closeup3",
  "--remote-debugging-port=9230"
], { detached: true, stdio: "ignore" });

await new Promise(r => setTimeout(r, 4000));
const CDP_URL = "http://127.0.0.1:9230";

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

const driver = `(async () => {
  const out = { fatal: null, log: [], failed: false };
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
    try {
      view.settings.viewMode = m;
      await view.rebuild();
      view.draw();
      
      let nodeIds = [];
      if (m === "heatmap" && view.laid.heatmap) {
         nodeIds = view.laid.heatmap.nodeIds[0] || [];
      } else if (m === "stream" && view.laid.stream) {
         const cell = view.laid.stream.matrix[0];
         if (cell) nodeIds = cell.nodeIds;
      } else if (m === "lattice" && view.laid.lattice) {
         const node = view.laid.lattice.nodes[0];
         if (node) nodeIds = node.nodeIds;
      } else {
         if (view.laid.nodes && view.laid.nodes.length) {
             nodeIds = [view.laid.nodes[0].id.split("\0").pop()];
         }
      }
      
      view.switchToCloseup(nodeIds);
      out.log.push("[" + m + "] switchToCloseup ok");
      
      view.switchToPanorama();
      out.log.push("[" + m + "] switchToPanorama ok");
    } catch(e) {
      out.failed = true;
      out.log.push("[" + m + "] Error: " + String(e && e.stack ? e.stack : e));
    }
  }
  return out;
})()`;

const evaluatePromise = req("Runtime.evaluate", { expression: driver, awaitPromise: true, returnByValue: true });
const timeoutPromise = new Promise((_, rej) => setTimeout(() => rej(new Error("Timeout")), 60000));
const resp = await Promise.race([evaluatePromise, timeoutPromise]);
console.log(JSON.stringify(resp, null, 2));

try { process.kill(-obs.pid); } catch(e){}
ws.close();
process.exit(resp.result?.result?.value?.failed ? 1 : 0);
