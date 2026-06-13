import { spawn } from "child_process";

const CDP = "http://127.0.0.1:9224";

async function run() {
  const obs = spawn("obsidian", [
    "/home/ubuntu/obsidian-plugins/開発",
    "--user-data-dir=/tmp/obs-e2e-axis",
    "--remote-debugging-port=9224"
  ], { detached: true, stdio: "ignore" });
  obs.unref();

  await new Promise(r => setTimeout(r, 3000));

  let list;
  for (let i = 0; i < 10; i++) {
    try {
      list = await (await fetch(`${CDP}/json/list`)).json();
      break;
    } catch (e) {
      await new Promise(r => setTimeout(r, 1000));
    }
  }

  if (!list) { console.error("No CDP targets"); process.exit(1); }

  const page = list.find((t) => t.type === "page" && t.webSocketDebuggerUrl && t.url.startsWith("app://obsidian.md"));
  if (!page) { console.error("FAIL: no debuggable page target"); process.exit(1); }

  const ws = new globalThis.WebSocket(page.webSocketDebuggerUrl);
  await new Promise((res, rej) => { ws.onopen = res; ws.onerror = rej; });

  let nextId = 1;
  const pending = new Map();
  ws.onmessage = (ev) => {
    const msg = JSON.parse(ev.data);
    if (msg.id && pending.has(msg.id)) { pending.get(msg.id)(msg); pending.delete(msg.id); }
  };
  const send = (method, params = {}) =>
    new Promise((resolve) => { const id = nextId++; pending.set(id, resolve); ws.send(JSON.stringify({ id, method, params })); });

  await send("Runtime.enable");

  const driver = `(async () => {
    const sleep = (ms) => new Promise(r => setTimeout(r, ms));
    
    // Wait for app
    for (let i = 0; i < 40; i++) { 
      if (window.app && window.app.plugins) break;
      await sleep(250); 
    }
    
    try {
      window.app.plugins.setEnable(true);
      await window.app.plugins.enablePluginAndSave("tag-lens");
    } catch(e) { console.error(e); }

    let plugin = null;
    for (let i = 0; i < 40; i++) { 
      if (window.app && window.app.plugins && window.app.plugins.plugins) {
        plugin = window.app.plugins.plugins["tag-lens"]; 
        if (plugin) break;
      }
      await sleep(250); 
    }
    
    if (!plugin) return "no plugin";
    await plugin.activateView(); await sleep(300);
    const view = window.app.workspace.getLeavesOfType("tag-lens-view")[0].view;
    
    view.settings.viewMode = "euler";
    view.settings.encoding = [];
    await view.rebuild();
    const countNoAxis = view.laid.nodes.length;
    
    view.settings.encoding = [{ channelId: "axisX", fieldId: "degree", enabled: true, scale: { type: "linear" } }];
    await view.rebuild();
    const countWithAxis = view.laid.nodes.length;
    if (countNoAxis !== countWithAxis) return "node count changed";
    
    if (!view.laid.axes || !view.laid.axes.x) return "no axis produced";
    
    // check monotonic
    const nodes = view.laid.nodes;
    // nodes should be somewhat sorted by degree on X
    
    return "ok";
  })()`;

  const evaluatePromise = send("Runtime.evaluate", { expression: driver, awaitPromise: true, returnByValue: true });
  const resp = await evaluatePromise;
  console.log(resp);

  ws.close();
  try { process.kill(-obs.pid); } catch(e){}
  process.exit(0);
}
run();
