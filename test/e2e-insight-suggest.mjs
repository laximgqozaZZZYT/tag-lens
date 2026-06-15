import { spawn } from "node:child_process";
import fs from "node:fs/promises";
import path from "node:path";

const VAULT_DIR = "/home/ubuntu/obsidian-plugins/開発";
const CDP_URL = "http://127.0.0.1:9224";

// Cleanup function to remove any artifact files from previous test runs
async function cleanup() {
	try {
		await fs.unlink(path.join(VAULT_DIR, "timeline.md"));
	} catch (e) {
		// Ignore if file doesn't exist
	}
}

await cleanup();

const obs = spawn("obsidian", [
  VAULT_DIR,
  "--user-data-dir=/tmp/obs-e2e-display",
  "--remote-debugging-port=9224"
], { detached: true, stdio: "ignore" });

const fail = (msg) => { console.error(`  ✗ ${msg}`); obs.kill(); process.exit(1); };
const pass = (msg) => { console.log(`  ✓ ${msg}`); };

await new Promise(r => setTimeout(r, 4000));

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
if (!list) { console.error("FAIL: CDP fetch failed"); obs.kill(); process.exit(1); }

const page = list.find((t) => t.type === "page" && t.webSocketDebuggerUrl && t.url.startsWith("app://obsidian.md"));
const ws = new WebSocket(page.webSocketDebuggerUrl);
await new Promise((res, rej) => { ws.onopen = res; ws.onerror = rej; });

let nextId = 1;
const pending = new Map();
ws.onmessage = (ev) => {
	const msg = JSON.parse(ev.data);
	if (msg.id && pending.has(msg.id)) { pending.get(msg.id)(msg); pending.delete(msg.id); return; }
	if (msg.method === "Runtime.consoleAPICalled") {
		console.log("[Browser Console]", msg.params.type, ...msg.params.args.map(a => a.value ?? a.description ?? ""));
	}
};
const send = (method, params = {}) =>
	new Promise((resolve) => { const id = nextId++; pending.set(id, resolve); ws.send(JSON.stringify({ id, method, params })); });

await send("Runtime.enable");

const driver = `(async () => {
  const sleep = (ms) => new Promise(r => setTimeout(r, ms));
  
  // Wait for app and metadata cache
  for (let i = 0; i < 40; i++) { 
    if (window.app && window.app.plugins) break;
    await sleep(250); 
  }
  
  if (!window.app || !window.app.plugins) {
	  return { error: "window.app or plugins not found after 10 seconds" };
  }
  
  // Force enable plugin
  window.app.plugins.setEnable(true);
  await window.app.plugins.disablePluginAndSave("tag-lens");
  await sleep(250);
  await window.app.plugins.enablePluginAndSave("tag-lens");
  await sleep(500);

  // Open Tag Lens view
  await window.app.workspace.getRightLeaf(false).setViewState({ type: "tag-lens-view" });
  
  let view = null;
  for (let i = 0; i < 20; i++) {
	  view = window.app.workspace.getLeavesOfType("tag-lens-view")[0]?.view;
	  if (view && view.noteMenu && view.noteMenu.querySelectorAll("button").length > 0) break;
	  await sleep(250);
  }
  if (!view) return { error: "Tag Lens view not found or not rendered" };

  const mainBtns = Array.from(view.noteMenu.querySelectorAll("button"));
  const insightBtn = mainBtns.find(b => b.textContent === "Insight");
  if (!insightBtn) return { error: "Insight tab button not found. Found: " + mainBtns.map(t => t.textContent).join(",") };
  insightBtn.click();
  await sleep(500);

  if (!view.insightHostEl) return { error: "view.insightHostEl is null after clicking Insight tab" };

  const subTabs = Array.from(view.insightHostEl.querySelectorAll("button"));
  const suggestBtn = subTabs.find(b => b.textContent === "Suggest");
  if (!suggestBtn) return { error: "Suggest sub-tab button not found. Found: " + subTabs.map(t => t.textContent).join(",") };
  suggestBtn.click();
  await sleep(800);

  const rows = Array.from(view.containerEl.querySelectorAll("tbody tr"));
  const timelineRow = rows.find(r => r.textContent.includes("#timeline"));
  if (!timelineRow) {
	  const foundTags = rows.map(r => r.querySelector("td")?.textContent).join(", ");
	  return { error: "Could not find #timeline in the suggestion table. Found tags: " + foundTags };
  }

  // Select 'task_org' from dropdown
  const select = timelineRow.querySelector("select");
  if (!select) return { error: "No dropdown found for #timeline" };
  select.value = "task_org";
  select.dispatchEvent(new Event("change"));

  // Click Apply Classification
  const applyBtn = Array.from(timelineRow.querySelectorAll("button")).find(b => b.textContent === "Apply Classification");
  if (!applyBtn) return { error: "Apply Classification button not found" };
  applyBtn.click();
  await sleep(1000); // Wait for file creation and caching

  // Read the resulting file cache
  const tagPage = window.app.metadataCache.getFirstLinkpathDest("timeline", "");
  if (!tagPage) return { error: "tagPage timeline.md was not created" };
  const fm = window.app.metadataCache.getFileCache(tagPage)?.frontmatter;

  return { success: true, fm: fm };
})()`;

console.log("\n--- E2E Insight Suggest Verification ---");

try {
	const res = await send("Runtime.evaluate", { expression: driver, awaitPromise: true, returnByValue: true });
	if (res.exceptionDetails) {
		fail(`Browser exception: ${res.exceptionDetails.exception.description}`);
	}

	const val = res.result.result?.value;

	if (!val) {
		fail(`Result value is undefined: ${JSON.stringify(res.result)}`);
	}

	if (val.error) {
		fail(val.error);
	}

	if (!val.fm || val.fm.golder_type !== "task_org") {
		console.error("Frontmatter:", val.fm);
		fail(`Frontmatter does not match expected golder_type: task_org`);
	}
	
	pass("Tag page created successfully and golder_type frontmatter applied correctly.");
} catch (e) {
	fail(`Exception thrown: ${e.message}`);
} finally {
	await cleanup();
	obs.kill();
}
