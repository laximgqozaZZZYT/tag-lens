const fs = require('fs');

// src/cluster-bbox.ts
let clusterBbox = fs.readFileSync('src/cluster-bbox.ts', 'utf8');
clusterBbox = clusterBbox.replace(/\/\/ Find the path from startSet[\s\S]*?return path;\n}\n/g, '');
fs.writeFileSync('src/cluster-bbox.ts', clusterBbox);

// src/draw-helpers.ts
let drawHelpers = fs.readFileSync('src/draw-helpers.ts', 'utf8');
drawHelpers = drawHelpers.replace(/\/\/ Shared footprint extent[\s\S]*?return \{ minCol, maxCol, minRow, maxRow \};\n}\n/g, '');
fs.writeFileSync('src/draw-helpers.ts', drawHelpers);

// src/lattice-layout.ts
let latticeLayout = fs.readFileSync('src/lattice-layout.ts', 'utf8');
latticeLayout = latticeLayout.replace(/new Array\((\w+)\)\.fill\(([^)]+)\)/g, 'new Array<number>($1).fill($2)');
fs.writeFileSync('src/lattice-layout.ts', latticeLayout);

// src/layout.ts
let layout = fs.readFileSync('src/layout.ts', 'utf8');
layout = layout.replace(/GraphEdge,\s*/g, '');
fs.writeFileSync('src/layout.ts', layout);

// src/qp-1d.ts
let qp1d = fs.readFileSync('src/qp-1d.ts', 'utf8');
qp1d = qp1d.replace(/function computeExtents[\s\S]*?return \{ min, max \};\n}\n/g, '');
fs.writeFileSync('src/qp-1d.ts', qp1d);

// src/region-layout.ts
let regionLayout = fs.readFileSync('src/region-layout.ts', 'utf8');
regionLayout = regionLayout.replace(/new Map\(\)/g, 'new Map<string, RegionRect>()');
fs.writeFileSync('src/region-layout.ts', regionLayout);

// src/subgroup-packing.ts
let subgroupPacking = fs.readFileSync('src/subgroup-packing.ts', 'utf8');
subgroupPacking = subgroupPacking.replace(/new Array\((\w+)\)/g, 'new Array<{x: number, y: number}>($1)');
fs.writeFileSync('src/subgroup-packing.ts', subgroupPacking);

// src/subgroup-relax.ts
let subgroupRelax = fs.readFileSync('src/subgroup-relax.ts', 'utf8');
subgroupRelax = subgroupRelax.replace(/function sharesAnyMembership[\s\S]*?return false;\n}\n/g, '');
fs.writeFileSync('src/subgroup-relax.ts', subgroupRelax);

console.log("Applied simple regex fixes.");
