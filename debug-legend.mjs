#!/usr/bin/env node
// Debug script to check legend display state

import { readFileSync } from "fs";
import { join } from "path";

const VAULT = process.env.TAG_LENS_VAULT || "/home/ubuntu/obsidian-plugins/開発";
const dataFile = join(VAULT, ".obsidian", "plugins", "tag-lens", "data.json");

try {
	const data = JSON.parse(readFileSync(dataFile, "utf8"));
	console.log("=== Tag Lens Settings ===");
	console.log("showLegend:", data.showLegend);
	console.log("legendHiddenModes:", JSON.stringify(data.legendHiddenModes, null, 2));
	console.log("encoding bindings:", JSON.stringify(data.encoding, null, 2));
	console.log("viewMode:", data.viewMode);
	console.log("perspective:", data.perspective);
	console.log("\n=== Analysis ===");
	
	if (data.showLegend === false) {
		console.log("⚠️  showLegend is FALSE - this is why legends don't appear!");
		console.log("To fix: Toggle the 'Show legend on canvas' checkbox in Settings → Encode");
	} else if (data.showLegend === true) {
		console.log("✓ showLegend is TRUE");
		
		if (data.legendHiddenModes && Object.keys(data.legendHiddenModes).length > 0) {
			console.log("⚠️  Some modes have hidden legends:", Object.keys(data.legendHiddenModes));
		}
		
		if (!data.encoding || data.encoding.length === 0) {
			console.log("ℹ️  No encoding bindings - legends will only show mode-specific info");
		} else {
			console.log("✓ Encoding bindings present:", data.encoding.length);
		}
	} else {
		console.log("⚠️  showLegend is undefined - using default (should be true)");
	}
} catch (err) {
	console.error("Error reading data.json:", err.message);
	console.log("File path:", dataFile);
}
