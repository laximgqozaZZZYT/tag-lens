import { VAULT } from "../config.mjs";
import { spawn } from "node:child_process";
import fs from "node:fs";

// F5 panel-open verification:
// - keep Tag Lens menu OPEN + PINNED to the right
// - ensure each mode still paints a legend close button
// - ensure legend close-rect stays OUTSIDE the pinned menu zone
// - dump screenshots for visual confirmation

const DIR = "/tmp/obs-e2e-f5-panel-open";
if (fs.existsSync(DIR)) fs.rmSync(DIR, { recursive: true });
fs.mkdirSync(DIR, { recursive: true });
fs.writeFileSync(`${DIR}/obsidian.json`, JSON.stringify({ vaults: { dev: { path: VAULT, ts: 1718270000000, open: true } } }));

const obs = spawn("obsidian", [
	VAULT,
	"--user-data-dir=" + DIR,
	"--remote-debugging-port=9239",
], { detached: true, stdio: "ignore" });

process.on("exit", () => {
	try { process.kill(-obs.pid); } catch (_) {}
	try { fs.rmSync(DIR, { recursive: true }); } catch (_) {}
});

await new Promise((r) => setTimeout(r, 3000));

const CDP_URL = "http://127.0.0.1:9239";
let list = null;
for (let i = 0; i < 20; i++) {
	try {
		const res = await fetch(`${CDP_URL}/json/list`);
		if (res.ok) {
			list = await res.json();
			break;
		}
	} catch (_) {}
	await new Promise((r) => setTimeout(r, 250));
}
if (!list) {
	console.error("FAIL: fetch failed");
	process.exit(1);
}

const page = list.find((t) => t.type === "page" && t.webSocketDebuggerUrl && t.url.startsWith("app://obsidian.md"));
if (!page) {
	console.error("FAIL: no Obsidian page target");
	process.exit(1);
}

const ws = new WebSocket(page.webSocketDebuggerUrl);
await new Promise((res, rej) => { ws.onopen = res; ws.onerror = rej; });

let nextId = 1;
const pending = new Map();
const consoleErrors = [];
ws.onmessage = (ev) => {
	const msg = JSON.parse(ev.data);
	if (msg.id && pending.has(msg.id)) {
		pending.get(msg.id)(msg);
		pending.delete(msg.id);
		return;
	}
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

const driver = `(async () => {
  const out = { fatal: null, modes: [], restored: false };
  const sleep = (ms) => new Promise(r => setTimeout(r, ms));
  const MODES = ["droste","euler","euler-true","euler-venn","bipartite","matrix","bubblesets","heatmap","lattice","upset","stream"];

  for (let i = 0; i < 40; i++) { if (window.app && window.app.plugins) break; await sleep(250); }

  let plugin = null;
  try {
    window.app.plugins.setEnable(true);
    if (!window.app.plugins.plugins["tag-lens"]) {
      await window.app.plugins.enablePluginAndSave("tag-lens");
    }
  } catch(e) { out.fatal = "enable err: " + e; return out; }
  for (let i = 0; i < 40; i++) { plugin = window.app.plugins.plugins["tag-lens"]; if (plugin) break; await sleep(250); }
  if (!plugin) { out.fatal = "plugin not loaded"; return out; }

  try {
    await plugin.activateView();
  } catch (e) {
    // Some Obsidian startup states have no tab group yet ("No tab group found").
    // Fallback: create/open a leaf directly.
    try {
      const leaf = window.app.workspace.getLeaf(true);
      await leaf.setViewState({ type: "tag-lens-view", active: true });
      window.app.workspace.revealLeaf(leaf);
    } catch (e2) {
      out.fatal = "activateView fallback err: " + (e2 && e2.stack || e2);
      return out;
    }
  }
  await sleep(350);
  const leaf = window.app.workspace.getLeavesOfType("tag-lens-view")[0];
  if (!leaf || !leaf.view) { out.fatal = "no view leaf"; return out; }
  const view = leaf.view;

  const snap = {
    viewMode: view.settings.viewMode,
    showLegend: view.settings.showLegend,
    legendHiddenModes: JSON.parse(JSON.stringify(view.settings.legendHiddenModes ?? {})),
    noteMenuVisible: !!view.settings.noteMenuVisible,
    noteMenuPinned: !!view.settings.noteMenuPinned,
    noteMenuPinnedWidth: view.settings.noteMenuPinnedWidth,
    encoding: JSON.parse(JSON.stringify(view.settings.encoding ?? [])),
  };

  try {
    view.settings.showLegend = true;
    view.settings.legendHiddenModes = {};
    view.settings.encoding = [];
    view.settings.noteMenuVisible = true;
    view.settings.noteMenuPinned = true;
    view.settings.noteMenuPinnedWidth = 320;

    for (const m of MODES) {
      const e = {
        mode: m,
        rebuild: "ok",
        draw: "ok",
        hasClose: false,
        closeRect: null,
        panelRect: null,
        canvasW: 0,
        menuW: 0,
        menuZoneOverlap: false,
      };
      try {
        view.settings.viewMode = m;
        await view.rebuild();
      } catch (err) {
        e.rebuild = String(err && err.stack || err);
      }
      await sleep(60);
      try {
        view.draw();
      } catch (err) {
        e.draw = String(err && err.stack || err);
      }
      await sleep(50);

      const menuEl = view.noteMenu || document.querySelector('[aria-label="Close menu"]')?.closest('div[style*="position: absolute"]');
      const menuW = menuEl ? menuEl.getBoundingClientRect().width : 0;
      const close = view.legendCloseRect;
      const panel = view.legendPanelRect || null;
      const cw = view.canvas.clientWidth || 0;

      e.hasClose = close != null;
      e.closeRect = close;
      e.panelRect = panel;
      e.canvasW = cw;
      e.menuW = menuW;
      if (close && cw > 0 && menuW > 0) {
        const closeRight = close.x + close.w;
        const visibleRight = cw - menuW;
        e.menuZoneOverlap = closeRight > visibleRight;
      }

      out.modes.push(e);
      await sleep(40);
    }
  } finally {
    try {
      view.settings.viewMode = snap.viewMode;
      view.settings.showLegend = snap.showLegend;
      view.settings.legendHiddenModes = snap.legendHiddenModes;
      view.settings.noteMenuVisible = snap.noteMenuVisible;
      view.settings.noteMenuPinned = snap.noteMenuPinned;
      view.settings.noteMenuPinnedWidth = snap.noteMenuPinnedWidth;
      view.settings.encoding = snap.encoding;
      await view.rebuild();
      view.draw();
      await view.save();
      out.restored = true;
    } catch (e) {
      out.restoreErr = String(e && e.stack || e);
    }
  }

  return out;
})()`;

const evalResp = await send("Runtime.evaluate", { expression: driver, awaitPromise: true, returnByValue: true });
if (evalResp.result?.exceptionDetails) {
	console.error("FAIL: driver threw:", JSON.stringify(evalResp.result.exceptionDetails).slice(0, 800));
	ws.close();
	process.exit(1);
}

const report = evalResp.result?.result?.value;
if (!report || report.fatal) {
	console.error("FAIL (fatal):", report?.fatal || "no report");
	ws.close();
	process.exit(1);
}

// capture screenshot per mode (panel open)
for (const m of report.modes) {
	await send("Runtime.evaluate", {
		expression: `(async () => {
      const sleep=(ms)=>new Promise(r=>setTimeout(r,ms));
      const leaf = window.app.workspace.getLeavesOfType("tag-lens-view")[0];
      const view = leaf?.view;
      if (!view) return;
      view.settings.noteMenuVisible = true;
      view.settings.noteMenuPinned = true;
      view.settings.noteMenuPinnedWidth = 320;
      view.settings.viewMode = ${JSON.stringify(m.mode)};
      await view.rebuild();
      view.draw();
      await sleep(80);
    })()`,
		awaitPromise: true,
		returnByValue: true,
	});
	const shot = await send("Page.captureScreenshot", { format: "png" });
	if (shot.result?.data) {
		fs.writeFileSync(`/tmp/f5-panel-open-${m.mode}.png`, Buffer.from(shot.result.data, "base64"));
	}
}

let failures = 0;
console.log("\n==== F5 panel-open legend check ====\n");
console.log("mode            rebuild draw close overlap closeRect");
for (const m of report.modes) {
	const okRebuild = m.rebuild === "ok";
	const okDraw = m.draw === "ok";
	const okClose = m.hasClose;
	const okOverlap = !m.menuZoneOverlap;
	const pass = okRebuild && okDraw && okClose && okOverlap;
	console.log(
		`${m.mode.padEnd(14)} ${okRebuild ? "ok" : "ER"}     ${okDraw ? "ok" : "ER"}   ${okClose ? "yes" : "NO "}   ${okOverlap ? "no " : "YES"}     ${m.closeRect ? JSON.stringify(m.closeRect) : "null"}`,
	);
	if (!pass) failures++;
}

console.log(`\nrestore settings: ${report.restored ? "yes" : "NO"}`);
if (report.restoreErr) console.log("restore error:", report.restoreErr);
if (!report.restored) failures++;

if (consoleErrors.length) {
	console.log(`\nconsole errors captured (${consoleErrors.length}):`);
	for (const c of consoleErrors.slice(0, 20)) console.log("  ! " + c.slice(0, 200));
	const relevant = consoleErrors.filter((c) => /tag-lens|legend|view\.ts|draw-|canvas/i.test(c));
	if (relevant.length) {
		failures += relevant.length;
		console.log(`  -> ${relevant.length} tag-lens-related errors counted as failures`);
	}
}

console.log("\nscreenshots: /tmp/f5-panel-open-<mode>.png");
console.log(`\n==== result: ${failures === 0 ? "PASS ✅" : `FAIL ✗ (${failures} issue(s))`} ====`);

ws.close();
process.exit(failures === 0 ? 0 : 1);
