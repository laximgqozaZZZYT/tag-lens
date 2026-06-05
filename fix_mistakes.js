const fs = require('fs');

let viewTs = fs.readFileSync('src/view.ts', 'utf8');

// 1. Revert activeWindow.totalNotes etc. to globalStats.totalNotes
// Note: My previous script changed `global.` to `activeWindow.`.
// This affected `global: {` -> `activeWindow: {` ? No, I replaced `global\.` which didn't match `global: `.
// Wait, my regex was `\bglobal\./g`. Let's see what it replaced. It replaced `global.totalNotes` which was accessing the returned object!
viewTs = viewTs.replace(/activeWindow\.totalNotes/g, 'globalStats.totalNotes');
viewTs = viewTs.replace(/activeWindow\.totalFolders/g, 'globalStats.totalFolders');
viewTs = viewTs.replace(/activeWindow\.totalLinks/g, 'globalStats.totalLinks');
viewTs = viewTs.replace(/activeWindow\.distinctTags/g, 'globalStats.distinctTags');
// Fix the property name itself from `global:` to `globalStats:`
viewTs = viewTs.replace(/global: \{ totalNotes/g, 'globalStats: { totalNotes');
viewTs = viewTs.replace(/global: \{/g, 'globalStats: {'); // just in case

// 2. Revert catch (_e) to catch (e) where e is actually used
// Let's just change all `catch (_e)` back to `catch (e)` and manually fix line 1821 later if needed.
viewTs = viewTs.replace(/catch \(_e\)/g, 'catch (e)');
// Let's also restore `(_e: MouseEvent) =>` to `(e: MouseEvent) =>`
viewTs = viewTs.replace(/\(_e: MouseEvent\) =>/g, '(e: MouseEvent) =>');

// 3. Revert `const _card = ` to `const card = `
viewTs = viewTs.replace(/const _card = /g, 'const card = ');

fs.writeFileSync('src/view.ts', viewTs);
console.log("Reverted mistakes in view.ts");
