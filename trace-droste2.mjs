import { buildIcon } from "/home/ubuntu/obsidian-plugins/tag-lens/src/layout/droste-layout.ts";

const nodeKeys = new Map([
  ["focus", ["character", "warrior", "drama"]],
  ["a", ["character", "warrior"]],   // shares 2 of T's 3 tags -> goes to d=1 (n=3, the FIRST ③ ring), keys.length=2
  ["b", ["character"]],
  ["c", ["warrior", "drama"]],
]);
const nodeLabel = new Map([...nodeKeys.keys()].map(k => [k, k]));
const labels = new Map([["character","character"],["warrior","warrior"],["drama","drama"]]);
const gallery = { nodeKeys, nodeLabel, labels, links: new Map(), backlinks: new Map() };
const icon = buildIcon(gallery, "focus");
console.log(JSON.stringify(icon, null, 2));
