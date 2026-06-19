import { layout } from "./src/layout/layout.ts";

const tags = ["character","warrior","drama","scene","creation","sequence"];
const nodes = [];
// simulate many single-tag nodes + a few multi-tag intersection nodes like the screenshot legend implies
for (let i=0;i<8;i++) nodes.push({id:`character_${i}`, label:`character_${i}`, memberships:["character"]});
for (let i=0;i<8;i++) nodes.push({id:`warrior_${i}`, label:`warrior_${i}`, memberships:["warrior"]});
for (let i=0;i<8;i++) nodes.push({id:`drama_${i}`, label:`drama_${i}`, memberships:["drama"]});
for (let i=0;i<8;i++) nodes.push({id:`scene_${i}`, label:`scene_${i}`, memberships:["scene"]});
// intersection nodes (like "sc01_flood-story" possibly in 2 tags)
nodes.push({id:"sc01_flood-story", label:"sc01_flood-story", memberships:["character","warrior"]});
nodes.push({id:"ep05_sc02_enkidus-drea", label:"ep05_sc02_enkidus-drea", memberships:["drama","scene"]});

const data = { nodes, edges: [] };
const sized = nodes.map(n=>({...n,width:80,height:40}));
const opts = {
  clusterSpacing:80, nodeSpacing:16, cellW:80, cellH:40, minFontPx:8,
  clusterLabels: new Map(), anchorPlacement:"concentric",
  viewMode:"bubblesets", bipartiteMaxTags:80, bipartiteLayout:"concentric",
};
const r = layout(data, sized, opts);
for (const c of r.clusters) {
  console.log("cluster", c.groupKey, "pieces:", JSON.stringify(c.pieces));
}
console.log("---areas---");
for (const c of r.clusters) console.log(c.groupKey, c.width*c.height);
