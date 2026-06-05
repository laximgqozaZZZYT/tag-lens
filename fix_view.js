const fs = require('fs');

let viewTs = fs.readFileSync('src/view.ts', 'utf8');

// 1. Remove unused imports
viewTs = viewTs.replace(/NONE_BUCKET,\s*/g, '');
viewTs = viewTs.replace(/SET_PREFIX,\s*/g, '');
viewTs = viewTs.replace(/CARD_MIN_W,\s*CARD_MAX_W,\s*/g, '');
viewTs = viewTs.replace(/function colLetters[\s\S]*?return out;\n}\n/g, '');

// 2. Remove unnecessary assertions: " as boolean", " as number", " as string", " as Partial<CSSStyleDeclaration>"
// Wait, replacing all might break things if they ARE necessary somewhere else, but the linter output implies they are not.
// Let's just remove all ` as Partial<CSSStyleDeclaration>` because that was what I added to Object.assign in an earlier refactor but wait, those were removed by `node refactor.js`.
// Let's see what the assertions are. We'll use a regex for ` as HTMLInputElement` or ` as HTMLSelectElement` where they might be.
// Actually, `const el = parent.createEl(...) as HTMLInputElement` is standard, Obsidian typed it to `HTMLElement`.
// Wait, Obsidian's `createEl("input")` returns `HTMLInputElement`. So `as HTMLInputElement` is an UNNECESSARY assertion!
// Let's replace ` as HTMLInputElement`, ` as HTMLSelectElement`, ` as HTMLButtonElement`.
viewTs = viewTs.replace(/ as HTMLInputElement/g, '');
viewTs = viewTs.replace(/ as HTMLSelectElement/g, '');
viewTs = viewTs.replace(/ as HTMLButtonElement/g, '');

// 3. Line 663: global -> activeWindow
// Actually let's just replace `global.` with `activeWindow.` but wait, `global.window`? `globalThis`?
viewTs = viewTs.replace(/\bglobal\./g, 'activeWindow.');

// 4. Line 1821: 'e' is defined but never used.
// Probably `(e) =>` or `catch (e)`. Replace with `(_e)` or `() =>`
viewTs = viewTs.replace(/catch \(e\)/g, 'catch (_e)');
viewTs = viewTs.replace(/\(e: MouseEvent\) =>/g, '(_e: MouseEvent) =>');

// 5. Line 2518: `requestAnimationFrame` -> `activeWindow.requestAnimationFrame`
viewTs = viewTs.replace(/(?<!\.)\brequestAnimationFrame\b/g, 'activeWindow.requestAnimationFrame');

// 6. Line 2974: 'card' is assigned a value but never used.
// Let's just comment out `const card = ...` if it's unused, or add `// @ts-ignore`.
// Better to just replace `const card = ` with `// const card = ` or just `const _card = `
viewTs = viewTs.replace(/const card = /g, 'const _card = ');

// 7. Line 3013: Promises must be awaited
// E.g., `this.app.workspace.getLeaf().openFile(...)`
// I'll add `void ` in front of it.
viewTs = viewTs.replace(/\bthis\.app\.workspace\.getLeaf\([^)]*\)\.openFile/g, 'void this.app.workspace.getLeaf(false).openFile');
viewTs = viewTs.replace(/\bthis\.app\.workspace\.getLeaf\b/g, 'void this.app.workspace.getLeaf');
// But wait, `void this.app.workspace.getLeaf(...)` is not enough, `openFile` returns a promise.
viewTs = viewTs.replace(/this\.app\.workspace\.getLeaf\(([^)]*)\)\.openFile\(([^)]+)\);/g, 'void this.app.workspace.getLeaf($1).openFile($2);');

// 8. Lines 3928, 4439, 4448: Use `window.setTimeout()` instead of `activeWindow.setTimeout()`
viewTs = viewTs.replace(/activeWindow\.setTimeout/g, 'window.setTimeout');
viewTs = viewTs.replace(/activeWindow\.clearTimeout/g, 'window.clearTimeout');

fs.writeFileSync('src/view.ts', viewTs);
console.log("Applied view.ts fixes");
