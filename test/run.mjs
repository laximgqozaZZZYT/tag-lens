// Bundle test/index.ts (which imports all *.test.ts) to a temp ESM file,
// then dynamically import it. Any thrown assertion exits non-zero.
import { build } from "esbuild";
import { pathToFileURL } from "node:url";
import { writeFileSync, mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const result = await build({
	entryPoints: ["test/index.ts"],
	bundle: true,
	format: "esm",
	platform: "node",
	alias: {
		"obsidian": "./test/obsidian.mock.ts"
	},
	write: false,
});
const dir = mkdtempSync(join(tmpdir(), "tag-lens-test-"));
const out = join(dir, "tests.mjs");
writeFileSync(out, result.outputFiles[0].text);
try {
	await import(pathToFileURL(out).href);
} catch (e) {
	console.error(e.message ?? e);
	process.exit(1);
}
