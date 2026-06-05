const fs = require('fs');
let code = fs.readFileSync('src/view.ts', 'utf-8');

code = code.replace(/\bwindow\.devicePixelRatio\b/g, 'activeWindow.devicePixelRatio');
code = code.replace(/\bwindow\.addEventListener\b/g, 'activeWindow.addEventListener');
code = code.replace(/\bwindow\.removeEventListener\b/g, 'activeWindow.removeEventListener');
code = code.replace(/\bwindow\.setTimeout\b/g, 'activeWindow.setTimeout');
code = code.replace(/\bwindow\.clearTimeout\b/g, 'activeWindow.clearTimeout');
code = code.replace(/\bdocument\.createElement\b/g, 'activeDocument.createElement');

fs.writeFileSync('src/view.ts', code, 'utf-8');
console.log("Refactored window and document in src/view.ts");
