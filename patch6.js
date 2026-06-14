const fs = require('fs');

let code = fs.readFileSync('src/draw-helpers.ts', 'utf8');

code = code.replace(
`					? [...axX.bands.map(b => b.start), axX.bands[axX.bands.length - 1].end]`,
`					? [...axX.bands.map(b => b.start), axX.bands.length > 0 ? axX.bands[axX.bands.length - 1].end : 0]`);

code = code.replace(
`					? [...axY.bands.map(b => b.start), axY.bands[axY.bands.length - 1].end]`,
`					? [...axY.bands.map(b => b.start), axY.bands.length > 0 ? axY.bands[axY.bands.length - 1].end : 0]`);

code = code.replace(
`const label = truncateToWidth(b.label, bwScreen - 12, ctx);`,
`const label = truncateToWidth(ctx, b.label, bwScreen - 12);`);

code = code.replace(
`const label = truncateToWidth(b.label, headerW - 8, ctx);`,
`const label = truncateToWidth(ctx, b.label, headerW - 8);`);

fs.writeFileSync('src/draw-helpers.ts', code);
