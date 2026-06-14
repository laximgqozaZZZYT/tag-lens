const fs = require('fs');
let code = fs.readFileSync('src/axis-layout.ts', 'utf8');

// Inside buildAxis for categorical:
code = code.replace(
`		let totalExtent = currentPos;
		let nSpan = Math.ceil(totalExtent / cellPitch);
		if (nSpan % 2 !== 0) nSpan += 1;
		totalExtent = Math.max(extent, nSpan * cellPitch);`,
`		let totalExtent = currentPos;
		let nSpan = Math.ceil(totalExtent / cellPitch);
		if (nSpan % 2 !== 0) nSpan += 1;
		totalExtent = Math.max(1, nSpan) * cellPitch; // DO NOT use Math.max(extent, ...) so it sizes exactly to contents`);

code = code.replace(
`	const outWidth = Math.max(opts.width, ax.extent);
	const outHeight = Math.max(opts.height, ay.extent);`,
`	const outWidth = opts.bindingX?.enabled ? ax.extent : Math.max(opts.width, ax.extent);
	const outHeight = opts.bindingY?.enabled ? ay.extent : Math.max(opts.height, ay.extent);`);

fs.writeFileSync('src/axis-layout.ts', code);
