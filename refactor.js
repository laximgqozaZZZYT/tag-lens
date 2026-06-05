const fs = require('fs');
let code = fs.readFileSync('src/view.ts', 'utf-8');

// Replace el.style.prop = "value"
code = code.replace(/([\w\.]+)\.style\.([a-zA-Z]+)\s*=\s*(.*?);/g, (match, el, prop, val) => {
    if (val.includes('===')) return match;
    if (val.includes('?')) {
        // e.g. a ? b : c
        return `${el}.setCssStyles({ ${prop}: ${val} });`;
    }
    return `${el}.setCssStyles({ ${prop}: ${val} });`;
});

// Fix detailsDiv.style.display = detailsDiv.style.display === "none" ? "block" : "none";
code = code.replace(/([\w\.]+)\.style\.([a-zA-Z]+)\s*=\s*([\w\.]+)\.style\.([a-zA-Z]+)\s*===\s*(".*?")\s*\?\s*(".*?")\s*:\s*(".*?");/g, (match, el1, prop1, el2, prop2, val1, val2, val3) => {
    return `${el1}.setCssStyles({ ${prop1}: ${el2}.style.${prop2} === ${val1} ? ${val2} : ${val3} });`;
});

// Replace Object.assign(el.style, { ... })
code = code.replace(/Object\.assign\(\s*([\w\.]+)\.style,\s*(\{[\s\S]*?\})(?:\s*as\s*Partial<CSSStyleDeclaration>)?\s*\);/g, (match, el, obj) => {
    return `${el}.setCssStyles(${obj});`;
});

fs.writeFileSync('src/view.ts', code, 'utf-8');
console.log("Refactored styles in src/view.ts");
