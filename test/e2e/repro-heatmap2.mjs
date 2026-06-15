import { VAULT } from "../config.mjs";
import { spawn } from "node:child_process";
import fs from "node:fs";

const DIR = "/tmp/obs-e2e-heatmap6";
const obs = spawn("obsidian", [
  VAULT,
  "--user-data-dir=" + DIR,
  "--remote-debugging-port=9232"
], { detached: true, stdio: "ignore" });

await new Promise(r => setTimeout(r, 4000));
const CDP_URL = "http://127.0.0.1:9232";
let list = null;
for (let i = 0; i < 20; i++) {
  try {
    const res = await fetch(`${CDP_URL}/json/list`);
    if (res.ok) { list = await res.json(); break; }
  } catch (e) {}
  await new Promise(r => setTimeout(r, 250));
}
const page = list.find((t) => t.type === "page" && t.webSocketDebuggerUrl && t.url.startsWith("app://obsidian.md"));
const ws = new WebSocket(page.webSocketDebuggerUrl);
await new Promise((res, rej) => { ws.onopen = res; ws.onerror = rej; });

let msgId = 1;
const req = (method, params = {}) => new Promise((resolve) => {
  const id = msgId++;
  const handler = (msg) => {
    const data = JSON.parse(msg.data);
    if (data.id === id) { ws.removeEventListener("message", handler); resolve(data.result); }
  };
  ws.addEventListener("message", handler);
  ws.send(JSON.stringify({ id, method, params }));
});

await req("Runtime.enable");

const driver = `(async () => {
  const sleep = ms => new Promise(r => setTimeout(r, ms));
  
  for (let i=0; i<40; i++) {
    if (window.app && window.app.plugins && window.app.plugins.plugins["tag-lens"]) break;
    await sleep(250);
  }

  let plugin = window.app.plugins.plugins["tag-lens"];
  if (!plugin) return { err: "no plugin" };
  await plugin.activateView(); await sleep(500);
  const view = window.app.workspace.getLeavesOfType("tag-lens-view")[0].view;

  view.settings.viewMode = "heatmap";
  view.settings.heatmapCriterion = "co-occurrence";
  view.settings.expandNeighborhood = false;
  await view.rebuild();
  await sleep(200);

  const h = view.laid.heatmap;
  let log = [];
  
  let targetI = -1;
  let targetJ = -1;
  for (let i = 0; i < h.n; i++) {
    for (let j = 0; j < h.n; j++) {
       if (h.tags[i].key.includes("battle") && h.tags[j].key.includes("battle")) {
          targetI = i;
          targetJ = j;
          break;
       }
    }
  }
  
  if (targetI === -1) {
     return { err: "battle tag not found" };
  }

  const expectedCount = h.counts[targetI * h.n + targetJ];
  log.push(\`Found battle*battle at [\${targetI},\${targetJ}]. Count = \${expectedCount}\`);
  
  // Click it
  view.openHeatmapDetail(targetI, targetJ, 0, 0);
  await sleep(1000); // wait for rebuild
  
  log.push(\`FocusNodeIds length: \${view.settings.focusNodeIds.length}\`);
  log.push(\`Resulting viewMode: \${view.settings.viewMode}\`);
  
  const nodes = view.laid.nodes;
  log.push(\`Laid out nodes count: \${nodes.length}\`);
  
  for (const n of nodes) {
     log.push(\`Node: \${n.label} (tags: \${n.memberships.join(",")})\`);
  }
  
  return log;
})()`;

const res = await req("Runtime.evaluate", { expression: driver, awaitPromise: true, returnByValue: true });
obs.kill();
console.log(JSON.stringify(res, null, 2));
