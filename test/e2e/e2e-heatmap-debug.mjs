import { VAULT } from "../config.mjs";
import { spawn } from "node:child_process";
import fs from "node:fs";

const DIR = "/tmp/obs-e2e-heatmap2";
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
  let plugin = window.app.plugins.plugins["tag-lens"];
  if (!plugin) return { err: "no plugin" };
  await plugin.activateView(); await sleep(500);
  const view = window.app.workspace.getLeavesOfType("tag-lens-view")[0].view;

  view.settings.viewMode = "heatmap";
  view.settings.heatmapCriterion = "co-occurrence";
  await view.rebuild();
  await sleep(200);

  const h = view.laid.heatmap;
  let errors = [];
  
  for (let i = 0; i < h.n; i++) {
    for (let j = 0; j < h.n; j++) {
      const expectedCount = h.counts[i * h.n + j];
      const nodeIdsI = h.nodeIds[i] || [];
      const nodeIdsJ = h.nodeIds[j] || [];
      const setB = new Set(nodeIdsJ);
      const ids = [...new Set(nodeIdsI.filter(id => setB.has(id)))];
      
      if (ids.length !== expectedCount) {
        errors.push(\`[\${i},\${j}] expected \${expectedCount}, intersection=\${ids.length}, Tag1=\${h.tags[i].label}, Tag2=\${h.tags[j].label}\`);
      }
    }
  }
  return errors;
})()`;

const res = await req("Runtime.evaluate", { expression: driver, awaitPromise: true, returnByValue: true });
obs.kill();
console.log(JSON.stringify(res, null, 2));
