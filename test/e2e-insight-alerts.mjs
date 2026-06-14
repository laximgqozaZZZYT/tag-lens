import { spawn } from "node:child_process";

const obs = spawn("obsidian", [
  "/home/ubuntu/obsidian-plugins/開発",
  "--user-data-dir=/tmp/obs-e2e-display",
  "--remote-debugging-port=9224"
], { detached: true, stdio: "ignore" });

await new Promise(r => setTimeout(r, 4000));

const CDP_URL = "http://127.0.0.1:9224";

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
  const out = { fatal: null, independent: null, plugin: null };
  const sleep = (ms) => new Promise(r => setTimeout(r, ms));
  
  for (let i = 0; i < 40; i++) { 
    if (window.app && window.app.plugins) break;
    await sleep(250); 
  }
  if (!window.app || !window.app.vault) throw new Error("window.app.vault is not ready after 10s");

  // 1. Independent calculation
  const indep = { orphans: [], overbroad: [], redundant: [] };
  try {
    const files = window.app.vault.getMarkdownFiles();
    const totalNotes = files.length;
    
    const tagMembers = new Map();
    const noteTagCount = new Map();
    const linksCount = new Map();
    
    for (const f of files) {
        const cache = window.app.metadataCache.getFileCache(f);
        const tags = new Set();
        if (cache?.tags) cache.tags.forEach(t => tags.add(t.tag.replace(/^#/, '')));
        const fmTags = cache?.frontmatter?.tags;
        if (Array.isArray(fmTags)) fmTags.forEach(t => tags.add(String(t).replace(/^#/, '')));
        else if (typeof fmTags === 'string') {
			fmTags.split(',').forEach(t => {
				const tr = t.trim();
				if (tr) tags.add(tr.replace(/^#/, ''));
			});
		}
        
        noteTagCount.set(f.path, tags.size);
        tags.forEach(t => {
            if (!tagMembers.has(t)) tagMembers.set(t, new Set());
            tagMembers.get(t).add(f.path);
        });
        
        linksCount.set(f.path, 0);
    }
    
    const resolved = window.app.metadataCache.resolvedLinks;
    for (const src of Object.keys(resolved)) {
        let outCount = 0;
        for (const tgt of Object.keys(resolved[src])) {
            outCount += resolved[src][tgt];
            linksCount.set(tgt, (linksCount.get(tgt) || 0) + resolved[src][tgt]);
        }
        linksCount.set(src, (linksCount.get(src) || 0) + outCount);
    }
    
	const basename = (p) => { const s = p.split("/").pop(); return s.endsWith(".md") ? s.slice(0, -3) : s; };

    indep.orphans = files.filter(f => (noteTagCount.get(f.path) || 0) === 0 && (linksCount.get(f.path) || 0) === 0).map(f => basename(f.path)).sort();
    
    // Overbroad tags: use getTags() occurrences to match plugin logic
    const vaultFreq = window.app.metadataCache.getTags();
    for (const [rawTag, count] of Object.entries(vaultFreq)) {
        const tag = rawTag.replace(/^#/, '');
        if (count / totalNotes > 0.4) indep.overbroad.push({ tag, count, ratio: count / totalNotes });
    }
    indep.overbroad.sort((a,b) => b.ratio - a.ratio);
    
	const tagsArr = Array.from(tagMembers.entries());
    for(let i=0; i<tagsArr.length; i++) {
        if(tagsArr[i][1].size < 2) continue;
        for(let j=i+1; j<tagsArr.length; j++) {
            if(tagsArr[j][1].size < 2) continue;
            let inter = 0;
            for(const path of tagsArr[i][1]) {
                if(tagsArr[j][1].has(path)) inter++;
            }
            const union = tagsArr[i][1].size + tagsArr[j][1].size - inter;
            const jaccard = inter / union;
            if (jaccard >= 0.9) {
				const a = tagsArr[i][0];
				const b = tagsArr[j][0];
				const pairKey = [a,b].sort().join("|");
                indep.redundant.push({ pairKey, jaccard });
            }
        }
    }
    indep.redundant.sort((a,b) => b.jaccard - a.jaccard);

    out.independent = indep;
  } catch (e) {
    out.fatal = "Independent calc error: " + e;
    return out;
  }

  // 2. Fetch plugin results
  try {
    window.app.plugins.setEnable(true);
    await window.app.plugins.disablePluginAndSave("tag-lens");
    await sleep(250);
    await window.app.plugins.enablePluginAndSave("tag-lens");
    
    let pluginObj = null;
    for (let i = 0; i < 40; i++) { pluginObj = window.app.plugins.plugins["tag-lens"]; if (pluginObj) break; await sleep(250); }
    if (!pluginObj) { out.fatal = "plugin not loaded."; return out; }
    
    await pluginObj.activateView(); await sleep(300);
    
    const leaf = window.app.workspace.getLeavesOfType("tag-lens-view")[0];
    const view = leaf.view;
    
    view.ensureNoteMenu();
    if (!view.noteMenu) { out.fatal = "noteMenu not created"; return out; }
    
    const tabs = Array.from(view.noteMenu.querySelectorAll("button"));
    const insightBtn = tabs.find(b => b.textContent === "Insight");
    if (insightBtn) insightBtn.click();
    await sleep(300);
    
    const subTabs = Array.from(view.noteMenu.querySelectorAll("button"));
    const alertsBtn = subTabs.find(b => b.textContent === "Alerts");
    if (alertsBtn) alertsBtn.click();
    await sleep(800); // Wait for IntersectionObserver batch rendering
    
    const host = view.insightHostEl || view.noteMenu;

    const scrollEl = host.querySelector('.gim-tree-scroll');
    if (scrollEl) {
        scrollEl.setAttribute('style', 'height: 100px !important; max-height: 100px !important; overflow: auto !important;');
        for (let i = 0; i < 30; i++) {
            scrollEl.scrollTop = scrollEl.scrollHeight + 9999;
            await sleep(150);
        }
    } else {
        host.setAttribute('style', 'height: 100px !important; max-height: 100px !important; overflow: auto !important;');
        for (let i = 0; i < 30; i++) {
            host.scrollTop = host.scrollHeight + 9999;
            await sleep(150);
        }
    }
    
    const pluginData = { orphans: [], overbroad: [], redundant: [], raw: host.innerText };

    const rawLines = host.innerText.split('\\n');
    let currentCategory = "ignore";
    for (const rawLine of rawLines) {
        const line = rawLine.toLowerCase();
        if (line.includes("orphan notes") || line.includes("no tags and no links") || line.includes("data silo")) currentCategory = "orphan";
        else if (line.includes("tag is too broad") || line.includes("contextual ambiguity") || line.includes("over-broad tag") || line.includes("covers over 40%")) currentCategory = "overbroad";
        else if (line.includes("redundant tag pair") || line.includes("near-identical membership") || line.includes("redundancy")) currentCategory = "redundant";
        else if (line.includes("overcrowded folder") || line.includes("excessive links") || line.includes("monolithic note") || line.includes("too many tags") || line.includes("ripening backlog") || line.includes("link candidates") || line.includes("ghost edges")) currentCategory = "ignore";
        else if (line.includes("• target:")) {
            const target = rawLine.replace('• Target:', '').trim();
            if (currentCategory === "orphan") pluginData.orphans.push(target);
            else if (currentCategory === "overbroad") pluginData.overbroad.push(target);
            else if (currentCategory === "redundant") pluginData.redundant.push(target);
        }
    }
    
    out.plugin = pluginData;
    
  } catch(e) { out.fatal = "plugin err: " + String(e && e.stack || e); return out; }

  return out;
})();`;

const evaluatePromise = send("Runtime.evaluate", { expression: driver, awaitPromise: true, returnByValue: true });
const timeoutPromise = new Promise((_, rej) => setTimeout(() => rej(new Error("E2E Test Hung Up (Timeout 60s)")), 60000));
let resp;
try {
  resp = await Promise.race([evaluatePromise, timeoutPromise]);
} catch (err) {
  console.error("FAIL (fatal):", err.message);
  ws.close();
  try { process.kill(-obs.pid); } catch(e){}
  process.exit(1);
}
if (resp.result?.exceptionDetails) {
	console.error("FAIL: driver threw:", JSON.stringify(resp.result.exceptionDetails).slice(0, 800));
	ws.close();
	try { process.kill(-obs.pid); } catch(e){}
	process.exit(1);
}
const report = resp.result.result.value;

if (report.fatal) { 
	console.error("FAIL (fatal):", report.fatal); 
	ws.close();
	try { process.kill(-obs.pid); } catch(e){}
	process.exit(1); 
}

let failures = 0;
const fail = (msg) => { failures++; console.log(`  ✗ ${msg}`); };
const pass = (msg) => { console.log(`  ✓ ${msg}`); };

const { independent: ind, plugin: pl } = report;

const uiOrphans = pl.orphans;
const uiOverbroad = pl.overbroad;
const uiRedundant = pl.redundant;

console.log("\n--- E2E Insight Alerts Verification ---");

// 1. Verify Orphans
const expectedOrphans = ind.orphans;
console.log(`\nOrphans (Independent calc: ${ind.orphans.length}, Plugin UI: ${uiOrphans.length})`);
for (const o of expectedOrphans) {
	if (!uiOrphans.includes(o)) fail(`Orphan note "${o}" missing in plugin UI`);
}
if (expectedOrphans.length === uiOrphans.length) pass(`Orphan note counts match exactly (${expectedOrphans.length})`);
else fail(`Orphan note counts mismatch: expected ${expectedOrphans.length}, got ${uiOrphans.length}`);

// 2. Verify Overbroad
const expectedOverbroad = ind.overbroad;
console.log(`\nOver-broad Tags (Independent calc: ${ind.overbroad.length}, Plugin UI: ${uiOverbroad.length})`);
for (const ob of expectedOverbroad) {
	const matched = uiOverbroad.some(uiText => uiText.startsWith(`#${ob.tag} (`));
	if (!matched) fail(`Overbroad tag "#${ob.tag}" missing in plugin UI`);
}
if (expectedOverbroad.length === uiOverbroad.length) pass(`Overbroad tag counts match exactly (${expectedOverbroad.length})`);
else fail(`Overbroad tag counts mismatch: expected ${expectedOverbroad.length}, got ${uiOverbroad.length}`);

// 3. Verify Redundant
const expectedRedundantCount = ind.redundant.length;
console.log(`\nRedundant Tag Pairs (Independent calc: ${ind.redundant.length}, Plugin UI: ${uiRedundant.length})`);
for (const r of ind.redundant) {
	const tags = r.pairKey.split("|");
	const matched = uiRedundant.some(uiText => 
		(uiText.includes(`#${tags[0]}`) && uiText.includes(`#${tags[1]}`))
	);
	if (!matched) fail(`Redundant pair "#${tags[0]} ↔ #${tags[1]}" missing in plugin UI`);
}
if (uiRedundant.length === expectedRedundantCount) pass(`Redundant pair counts match correctly (capped at ${expectedRedundantCount})`);
else fail(`Redundant pair counts mismatch (expected ${expectedRedundantCount}, got ${uiRedundant.length})`);

console.log("\nRAW PLUGIN TEXT:");
console.log(pl.raw);

console.log("\n==== E2E result: " + (failures === 0 ? "PASS ✅" : "FAIL ✗ (" + failures + " issue(s))") + " ====");

ws.close();
try { process.kill(-obs.pid); } catch(e){}
process.exit(failures === 0 ? 0 : 1);
