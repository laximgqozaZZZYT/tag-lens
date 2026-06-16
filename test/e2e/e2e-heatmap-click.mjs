import { VAULT } from "../config.mjs";
import { spawn } from "node:child_process";
import fs from "node:fs";

const DIR = "/tmp/obs-e2e-heatmap";
if (!fs.existsSync(DIR)) fs.mkdirSync(DIR, { recursive: true });
fs.writeFileSync(`${DIR}/obsidian.json`, JSON.stringify({"vaults":{"dev":{"path":VAULT,"ts":1718270000000,"open":true}}}));

const obs = spawn("obsidian", [
  VAULT,
  "--user-data-dir=" + DIR,
  "--remote-debugging-port=9231"
], { detached: true, stdio: "ignore" });

await new Promise(r => setTimeout(r, 4000));
const CDP_URL = "http://127.0.0.1:9231";

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
  for (let i=0; i<40; i++) { if (window.app && window.app.plugins) break; await sleep(250); }
  let plugin = null;
  try {
    window.app.plugins.setEnable(true);
    await window.app.plugins.disablePluginAndSave("tag-lens");
    await sleep(250);
    await window.app.plugins.enablePluginAndSave("tag-lens");
  } catch(e) { return "enable err"; }
  for(let i=0; i<40; i++) { plugin = window.app.plugins.plugins["tag-lens"]; if(plugin) break; await sleep(250); }
  await plugin.activateView(); await sleep(500);
  const leaf = window.app.workspace.getLeavesOfType("tag-lens-view")[0];
  const view = leaf.view;

  view.settings.viewMode = "heatmap";
  view.settings.heatmapCriterion = "co-occurrence";
  await view.rebuild();
  await sleep(200);

  const h = view.laid.heatmap;
  let errors = [];

  for (let i = 0; i < h.n; i++) {
    for (let j = 0; j < h.n; j++) {
      const expectedCount = h.counts[i * h.n + j];
      if (expectedCount === 0) continue;

      view.openHeatmapDetail(i, j, 0, 0); // simulate click
      await sleep(10);

      const actualIds = view.settings.focusNodeIds;
      if (!actualIds || actualIds.length !== expectedCount) {
        errors.push(\`[\${i},\${j}] expected \${expectedCount} nodes, got \${actualIds ? actualIds.length : 'none'}. Tag1=\${h.tags[i].label}, Tag2=\${h.tags[j].label}\`);
      }

      view.switchToPanorama();
    }
  }
  return errors;
})()`;

const res = await req("Runtime.evaluate", { expression: driver, awaitPromise: true, returnByValue: true });
obs.kill();
if (res.result.value && res.result.value.length > 0) {
  console.log("ERRORS:\\n" + res.result.value.join("\\n"));
} else {
  console.log("All counts match exactly!");
}
