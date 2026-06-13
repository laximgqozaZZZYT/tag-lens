import { spawn } from "child_process";
import fs from "fs";

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
    
    if (!plugin) return JSON.stringify({ fatal: "FAIL: no plugin" });
    await plugin.activateView(); await sleep(500);
    const view = window.app.workspace.getLeavesOfType("tag-lens-view")[0].view;
    
    const originalSettings = JSON.parse(JSON.stringify(view.settings));
    const failures = [];

    function getFieldValue(node, fieldId) {
      if (fieldId === "tag") return node.memberships?.[0] ?? null;
      if (fieldId === "status") return node.fmStatus ?? null;
      if (fieldId === "maturity") return node.fmMaturity ?? null;
      if (fieldId === "ageDays") return node.ageDays ?? null;
      if (fieldId.startsWith("frontmatter:")) {
        const key = fieldId.slice("frontmatter:".length);
        const f = window.app.vault.getAbstractFileByPath(node.id.split("\\t").pop());
        if (f) {
          const cache = window.app.metadataCache.getFileCache(f);
          return cache?.frontmatter?.[key] ?? null;
        }
      }
      return null;
    }

    async function runScenario(scenarioName, encoding) {
      view.settings.viewMode = "euler";
      view.settings.encoding = encoding;
      view.lastRebuildSig = "";
      await view.rebuild();
      await sleep(300);

      const laid = view.laid;
      if (!laid) {
        failures.push({ scenario: scenarioName, check: "Initialization", msg: "view.laid is undefined" });
        return;
      }

      // Check 1: Label fitting inside grid boundary (width/height of band)
      const fontPx = 14;
      if (laid.axes?.x && laid.axes.x.kind === "categorical" && laid.axes.x.bands) {
        // Check if bands are of variable width (meaning not all are identical)
        const widths = laid.axes.x.bands.map(b => b.end - b.start);
        const allSame = widths.every(w => w === widths[0]);
        if (allSame && widths.length > 1) {
          failures.push({ scenario: scenarioName, check: "Check 1: Variable Width", msg: "X axis grid lines/bands are not of variable width (all are " + widths[0] + ")" });
        }

        for (const b of laid.axes.x.bands) {
          const tw = view.measureLatticeText(b.label, fontPx);
          const bw = b.end - b.start;
          if (tw > bw) {
            failures.push({ scenario: scenarioName, check: "Check 1: Label Fit", msg: "X Label '" + b.label + "' (width " + tw.toFixed(1) + ") exceeds band width (" + bw + ")" });
          }
        }
      }

      if (laid.axes?.y && laid.axes.y.kind === "categorical" && laid.axes.y.bands) {
        const heights = laid.axes.y.bands.map(b => b.end - b.start);
        const allSame = heights.every(h => h === heights[0]);
        if (allSame && heights.length > 1) {
          failures.push({ scenario: scenarioName, check: "Check 1: Variable Width", msg: "Y axis grid lines/bands are not of variable width (all are " + heights[0] + ")" });
        }

        for (const b of laid.axes.y.bands) {
          const th = view.measureLatticeText(b.label, fontPx);
          const bh = b.end - b.start;
          if (th > bh) {
            failures.push({ scenario: scenarioName, check: "Check 1: Label Fit", msg: "Y Label '" + b.label + "' (width " + th.toFixed(1) + ") exceeds band height (" + bh + ")" });
          }
        }
      }

      // Check 2: Label Overlapping
      // In drawGridHeaders, labels are centered at b.center and scaled down if needed.
      // But if targetFont is capped at 6, they might still overlap.
      // Let's compute their actual rendered bounds.
      if (laid.axes?.x && laid.axes.x.kind === "categorical" && laid.axes.x.bands) {
        const bands = laid.axes.x.bands;
        const bounds = bands.map(b => {
          const tw = view.measureLatticeText(b.label, fontPx);
          const bw = b.end - b.start;
          const targetFont = Math.max(6, fontPx * Math.min(1, (bw - 8) / Math.max(1, tw)));
          const renderedTw = tw * (targetFont / fontPx);
          return {
            left: b.center - renderedTw / 2,
            right: b.center + renderedTw / 2,
            label: b.label
          };
        });
        for (let i = 0; i < bounds.length - 1; i++) {
          if (bounds[i].right > bounds[i+1].left + 0.01) {
            failures.push({ scenario: scenarioName, check: "Check 2: Label Overlap", msg: "X Labels '" + bounds[i].label + "' and '" + bounds[i+1].label + "' overlap on screen" });
          }
        }
      }

      if (laid.axes?.y && laid.axes.y.kind === "categorical" && laid.axes.y.bands) {
        const bands = laid.axes.y.bands;
        const bounds = bands.map(b => {
          const th = view.measureLatticeText(b.label, fontPx);
          const bh = b.end - b.start;
          const targetFont = Math.max(6, fontPx * Math.min(1, (bh - 8) / Math.max(1, th)));
          const renderedTh = th * (targetFont / fontPx);
          return {
            top: b.center - renderedTh / 2,
            bottom: b.center + renderedTh / 2,
            label: b.label
          };
        });
        for (let i = 0; i < bounds.length - 1; i++) {
          if (bounds[i].bottom > bounds[i+1].top + 0.01) {
            failures.push({ scenario: scenarioName, check: "Check 2: Label Overlap", msg: "Y Labels '" + bounds[i].label + "' and '" + bounds[i+1].label + "' overlap on screen" });
          }
        }
      }

      // Check 3: Node-to-band alignment
      const bindingX = encoding.find(e => e.channelId === "axisX");
      const bindingY = encoding.find(e => e.channelId === "axisY");
      const nodes = laid.nodes || [];

      for (const node of nodes) {
        if (node.id.startsWith("\\0")) continue;
        const w = node.width ?? 120;
        const h = node.height ?? 75;

        if (bindingX && bindingX.enabled && laid.axes?.x && laid.axes.x.kind === "categorical" && laid.axes.x.bands) {
          const val = getFieldValue(node, bindingX.fieldId);
          if (val !== null) {
            const band = laid.axes.x.bands.find(b => b.key === String(val));
            if (!band) {
              failures.push({ scenario: scenarioName, check: "Check 3: Node Alignment", msg: "Node '" + node.label + "' has value '" + val + "' but no corresponding X band exists" });
            } else {
              const nodeLeft = node.x - w / 2;
              const nodeRight = node.x + w / 2;
              if (nodeLeft < band.start - 0.1 || nodeRight > band.end + 0.1) {
                failures.push({ scenario: scenarioName, check: "Check 3: Node Alignment", msg: "Node '" + node.label + "' (x: " + node.x + ", width: " + w + ") overflows its X band '" + band.label + "' [" + band.start + ", " + band.end + "]" });
              }
            }
          }
        }

        if (bindingY && bindingY.enabled && laid.axes?.y && laid.axes.y.kind === "categorical" && laid.axes.y.bands) {
          const val = getFieldValue(node, bindingY.fieldId);
          if (val !== null) {
            const band = laid.axes.y.bands.find(b => b.key === String(val));
            if (!band) {
              failures.push({ scenario: scenarioName, check: "Check 3: Node Alignment", msg: "Node '" + node.label + "' has value '" + val + "' but no corresponding Y band exists" });
            } else {
              const nodeTop = node.y - h / 2;
              const nodeBottom = node.y + h / 2;
              if (nodeTop < band.start - 0.1 || nodeBottom > band.end + 0.1) {
                failures.push({ scenario: scenarioName, check: "Check 3: Node Alignment", msg: "Node '" + node.label + "' (y: " + node.y + ", height: " + h + ") overflows its Y band '" + band.label + "' [" + band.start + ", " + band.end + "]" });
              }
            }
          }
        }
      }

      // Check 4: Node Overlapping
      for (let i = 0; i < nodes.length; i++) {
        const n1 = nodes[i];
        if (n1.id.startsWith("\\0")) continue;
        const w1 = n1.width ?? 120;
        const h1 = n1.height ?? 75;
        const l1 = n1.x - w1 / 2;
        const r1 = n1.x + w1 / 2;
        const t1 = n1.y - h1 / 2;
        const b1 = n1.y + h1 / 2;

        for (let j = i + 1; j < nodes.length; j++) {
          const n2 = nodes[j];
          if (n2.id.startsWith("\\0")) continue;
          const w2 = n2.width ?? 120;
          const h2 = n2.height ?? 75;
          const l2 = n2.x - w2 / 2;
          const r2 = n2.x + w2 / 2;
          const t2 = n2.y - h2 / 2;
          const b2 = n2.y + h2 / 2;

          const overlapX = Math.max(l1, l2) < Math.min(r1, r2) - 0.01;
          const overlapY = Math.max(t1, t2) < Math.min(b1, b2) - 0.01;
          if (overlapX && overlapY) {
            failures.push({ scenario: scenarioName, check: "Check 4: Node Overlap", msg: "Node '" + n1.label + "' and Node '" + n2.label + "' overlap with each other" });
          }
        }
      }
    }

    // Scenario 1: One-axis categorical (X = tag, Y = disabled)
    await runScenario("1-axis (X=tag)", [
      { channelId: "axisX", fieldId: "tag", enabled: true, scale: { type: "categorical" } }
    ]);

    // Scenario 2: Two-axes categorical (X = tag, Y = maturity)
    await runScenario("2-axis (X=tag, Y=maturity)", [
      { channelId: "axisX", fieldId: "tag", enabled: true, scale: { type: "categorical" } },
      { channelId: "axisY", fieldId: "maturity", enabled: true, scale: { type: "categorical" } }
    ]);

    // Restore original settings
    Object.assign(view.settings, originalSettings);
    view.lastRebuildSig = "";
    await view.rebuild();

    return JSON.stringify({ failures });
  })()`;

  const evaluatePromise = send("Runtime.evaluate", { expression: driver, awaitPromise: true, returnByValue: true });
  const resp = await evaluatePromise;
  const val = resp.result?.result?.value;
  ws.close();
  try { process.kill(-obs.pid); } catch(e){}

  const result = JSON.parse(val || "{}");
  if (result.fatal) {
    console.error(result.fatal);
    process.exit(1);
  }

  console.log("\n=================== E2E Axis Layout Validation Report ===================");
  if (result.failures.length === 0) {
    console.log("PASS ✅: No axis layout failures detected.");
    process.exit(0);
  } else {
    console.log(`FAIL ✗: Detected ${result.failures.length} issue(s)`);
    for (const f of result.failures.slice(0, 50)) {
      console.log(`  [${f.scenario}] [${f.check}] ${f.msg}`);
    }
    if (result.failures.length > 50) {
      console.log(`  ... and ${result.failures.length - 50} more failures.`);
    }
    process.exit(1);
  }
}
run();
