// Copy the built plugin (main.js + manifest.json + styles.css) into the target
// Obsidian vault's plugin folder. Replaces the manual `cp ...` step. The vault
// is the single source of truth in test/config.mjs (override with TAG_LENS_VAULT):
//
//   npm run deploy
//   TAG_LENS_VAULT=/path/to/other/vault npm run deploy
//
// `npm run deploy` builds first (see package.json); this script only copies.
import fs from "node:fs";
import path from "node:path";
import { VAULT } from "./test/config.mjs";

const pluginDir = path.join(VAULT, ".obsidian", "plugins", "tag-lens");
fs.mkdirSync(pluginDir, { recursive: true });

const FILES = ["main.js", "manifest.json", "styles.css"];
let copied = 0;
for (const f of FILES) {
	if (!fs.existsSync(f)) {
		if (f === "main.js") {
			console.error(`deploy: ${f} not found — run \`npm run build\` first.`);
			process.exit(1);
		}
		console.warn(`deploy: skipping missing ${f}`);
		continue;
	}
	fs.copyFileSync(f, path.join(pluginDir, f));
	console.log(`deploy: ${f} -> ${path.join(pluginDir, f)} (${fs.statSync(f).size} bytes)`);
	copied++;
}
console.log(`deploy: ${copied} file(s) copied. Reload Obsidian to apply.`);
