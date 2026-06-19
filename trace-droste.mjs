import { buildIcon } from "/home/ubuntu/obsidian-plugins/tag-lens/src/layout/droste-layout.ts";

const nodeKeys = new Map([
  ["focus", ["character", "warrior"]],
  ["a", ["character"]],
  ["b", ["warrior"]],
  ["c", ["character", "warrior"]],  // shares BOTH tags -> should populate the 2-key subset ring
  ["d", ["character", "warrior", "drama"]],
]);
const nodeLabel = new Map([...nodeKeys.keys()].map(k => [k, k]));
const labels = new Map([["character","character"],["warrior","warrior"],["drama","drama"]]);

const gallery = {
  nodeKeys, nodeLabel, labels,
  links: new Map(), backlinks: new Map(),
};

const icon = buildIcon(gallery, "focus");
console.log(JSON.stringify(icon, null, 2));
