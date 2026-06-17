import { VAULT } from "../config.mjs";
import { spawn } from "node:child_process";
import fs from "node:fs";

// N2 regression test: disable → re-enable the plugin and confirm:
//   1. No "existing view type" error/warning
//   2. The view can be activated and draws successfully after re-enable
//   3. Console has no tag-lens-related errors during the cycle

const DIR = "/tmp/obs-e2e-n2";
if (fs.existsSync(DIR)) fs.rmSync(DIR, { recursive: true });
fs.mkdirSync(DIR, { recursive: true });
fs.writeFileSync(
	`${DIR}/obsidian.json`,
	JSON.stringify({ vaults: { dev: { path: VAULT, ts: 1718270000000, open: true } } }),
);

const obs = spawn("obsidian", [VAULT, "--user-data-dir=" + DIR, "--remote-debugging-port=9237"], {
	detached: true,
	stdio: "ignore",
});
process.on("exit", () => {
	try { process.kill(-obs.pid); } catch (_) {}
	try { fs.rmSync(DIR, { recursive: true }); } catch (_) {}
});

await new Promise((r) => setTimeout(r, 4000));

const CDP_URL = "http://127.0.0.1:9237";

// ---- minimal CDP client ----
let list = null;
for (let i = 0; i < 30; i++) {
	try {
		const res = await fetch(`${CDP_URL}/json/list`);
		if (res.ok) { list = await res.json(); break; }
	} catch (_) {}
	await new Promise((r) => setTimeout(r, 500));
}
if (!list) { console.error("FAIL: CDP not reachable"); process.exit(1); }

const page = list.find(
	(t) => t.type === "page" && t.webSocketDebuggerUrl && t.url.startsWith("app://obsidian.md"),
);
if (!page) { console.error("FAIL: no Obsidian page target"); process.exit(1); }

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
		consoleErrors.push(
			"console.error: " + msg.params.args.map((a) => a.value ?? a.description ?? "").join(" "),
		);
	}
};
const send = (method, params = {}) =>
	new Promise((resolve) => {
		const id = nextId++;
		pending.set(id, resolve);
		ws.send(JSON.stringify({ id, method, params }));
	});

await send("Runtime.enable");

// ---- driver: disable → re-enable → verify ----
const driver = `(async () => {
  const out = {
    fatal: null,
    initialEnable: "skip",
    disableOk: false,
    reEnableOk: false,
    viewAfterReEnable: false,
    drawOk: false,
    laidNodes: 0,
    existingViewTypeError: false,
  };
  const sleep = (ms) => new Promise(r => setTimeout(r, ms));

  // Wait for app.plugins
  for (let i = 0; i < 40; i++) {
    if (window.app && window.app.plugins) break;
    await sleep(250);
  }
  if (!window.app || !window.app.plugins) {
    out.fatal = "app.plugins not available";
    return out;
  }

  // Intercept console.error to detect "existing view type" warning
  const origError = console.error;
  const origWarn = console.warn;
  const captured = [];
  console.error = (...args) => { captured.push(args.join(" ")); origError.apply(console, args); };
  console.warn = (...args) => { captured.push(args.join(" ")); origWarn.apply(console, args); };

  try {
    // Step 1: ensure plugin is enabled initially
    window.app.plugins.setEnable(true);
    if (!window.app.plugins.plugins["tag-lens"]) {
      await window.app.plugins.enablePluginAndSave("tag-lens");
      out.initialEnable = "freshEnable";
    } else {
      out.initialEnable = "alreadyLoaded";
    }
    await sleep(500);

    const plugin = window.app.plugins.plugins["tag-lens"];
    if (!plugin) { out.fatal = "plugin not loaded after initial enable"; return out; }

    // Activate and verify initial state
    await plugin.activateView();
    await sleep(300);

    // Step 2: DISABLE the plugin
    await window.app.plugins.disablePluginAndSave("tag-lens");
    await sleep(500);
    out.disableOk = !window.app.plugins.plugins["tag-lens"];

    // Verify view leaves are detached
    const leavesAfterDisable = window.app.workspace.getLeavesOfType("tag-lens-view").length;

    // Step 3: RE-ENABLE the plugin
    await window.app.plugins.enablePluginAndSave("tag-lens");
    await sleep(800);
    out.reEnableOk = !!window.app.plugins.plugins["tag-lens"];

    // Check for "existing view type" in captured messages
    out.existingViewTypeError = captured.some(
      (m) => m.includes("existing view type") || m.includes("View type already registered")
    );

    // Step 4: activate view after re-enable and test draw
    const pluginAfter = window.app.plugins.plugins["tag-lens"];
    if (pluginAfter) {
      await pluginAfter.activateView();
      await sleep(500);
      const leaf = window.app.workspace.getLeavesOfType("tag-lens-view")[0];
      out.viewAfterReEnable = !!(leaf && leaf.view);
      if (leaf && leaf.view) {
        const view = leaf.view;
        try {
          await view.rebuild();
          view.draw();
          out.drawOk = true;
          out.laidNodes = (view.laid.nodes || []).length;
        } catch (e) {
          out.drawOk = "draw error: " + String(e);
        }
      }
    }
  } catch (e) {
    out.fatal = String(e && e.stack || e);
  } finally {
    console.error = origError;
    console.warn = origWarn;
  }
  return out;
})()`;

const evaluatePromise = send("Runtime.evaluate", {
	expression: driver,
	awaitPromise: true,
	returnByValue: true,
});
const timeoutPromise = new Promise((_, rej) =>
	setTimeout(() => rej(new Error("E2E N2 test timed out (45s)")), 45000),
);

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
	ws.close();
	process.exit(1);
}

const r = resp.result.result.value;
await new Promise((r) => setTimeout(r, 500)); // drain late console errors

// ---- report ----
let failures = 0;
const fail = (msg) => { failures++; console.log("  ✗ " + msg); };
const pass = (msg) => console.log("  ✓ " + msg);

console.log("\n==== E2E N2: plugin disable → re-enable cycle ====\n");

if (r.fatal) { fail("fatal: " + r.fatal); }

if (r.disableOk) pass("plugin disabled successfully");
else fail("plugin still present after disable");

if (r.reEnableOk) pass("plugin re-enabled successfully");
else fail("plugin not present after re-enable");

if (!r.existingViewTypeError) pass("no 'existing view type' error during re-enable");
else fail("'existing view type' error detected during re-enable cycle");

if (r.viewAfterReEnable) pass("view activatable after re-enable");
else fail("view not activatable after re-enable");

if (r.drawOk === true) pass(`draw() succeeded after re-enable (${r.laidNodes} laid nodes)`);
else fail("draw failed after re-enable: " + r.drawOk);

// Check console errors for tag-lens related issues
const relevant = consoleErrors.filter(
	(c) => /tag-lens|MiniGraphView|view\.ts|registerView|existing view/i.test(c),
);
if (relevant.length === 0) pass("no tag-lens console errors during cycle");
else {
	for (const c of relevant) fail("console: " + c.slice(0, 200));
}

console.log(
	"\n==== N2 result: " +
		(failures === 0 ? "PASS ✅" : "FAIL ✗ (" + failures + " issue(s))") +
		" ====",
);

ws.close();
process.exit(failures === 0 ? 0 : 1);
