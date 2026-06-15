import { VAULT } from "../config.mjs";
import { spawn } from "child_process";
const CDP = "http://127.0.0.1:9224";

async function run() {
  const obs = spawn("obsidian", [
    VAULT,
    "--user-data-dir=/tmp/obs-e2e-axis",
    "--remote-debugging-port=9224"
  ], { detached: true, stdio: "ignore" });
  obs.unref();

  await new Promise(r => setTimeout(r, 3000));

  let list;
  for (let i = 0; i < 10; i++) {
    try { list = await (await fetch(`${CDP}/json/list`)).json(); break; } catch (e) { await new Promise(r => setTimeout(r, 1000)); }
  }
  const page = list.find((t) => t.type === "page" && t.webSocketDebuggerUrl && t.url.startsWith("app://obsidian.md"));
  const ws = new globalThis.WebSocket(page.webSocketDebuggerUrl);

  await new Promise((r) => { ws.onopen = r; });
  let _msgId = 0;
  const send = (method, params) => new Promise((resolve) => {
    const id = ++_msgId;
    const l = (e) => {
      const msg = JSON.parse(e.data);
      if (msg.id === id) { ws.removeEventListener("message", l); resolve(msg); }
    };
    ws.addEventListener("message", l);
    ws.send(JSON.stringify({ id, method, params }));
  });

  const driver = `(async () => {
    function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }
    let plugin;
    for (let i = 0; i < 20; i++) {
      if (window.app && window.app.plugins && window.app.plugins.plugins) {
        plugin = window.app.plugins.plugins["tag-lens"]; 
        if (plugin) break;
      }
      await sleep(250); 
    }
    await plugin.activateView(); await sleep(300);
    const view = window.app.workspace.getLeavesOfType("tag-lens-view")[0].view;
    view.settings.viewMode = "euler";
    view.settings.encoding = [{ channelId: "axisX", fieldId: "degree", enabled: true, scale: { type: "linear" } }];
    await view.rebuild();
    const edges = view.laid.edges || [];
    const nodes = view.laid.nodes;
    if (edges.length === 0) return "no edges";
    const e = edges[0];
    const targetNode = nodes.find(n => n.id === e.target);
    return {
      targetId: e.target,
      targetNodeExists: !!targetNode,
    };
  })()`;

  const evaluatePromise = send("Runtime.evaluate", { expression: driver, awaitPromise: true, returnByValue: true });
  const resp = await evaluatePromise;
  console.log(JSON.stringify(resp.result.result.value, null, 2));

  ws.close();
  try { process.kill(-obs.pid); } catch(e){}
  process.exit(0);
}
run();
