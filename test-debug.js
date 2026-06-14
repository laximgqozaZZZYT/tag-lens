const assert = require("assert");
let obj = { path: [{x: 132, y: 316}] };
let edges = [obj];
let path = [{x: -2880, y: -1120}];
for (const e of edges) {
  e.path = path;
}
console.log(edges[0].path[0].x);
