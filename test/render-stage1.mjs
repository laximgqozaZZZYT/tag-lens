// Stage 1 offline verification: warp a uniform 12×12 grid over a SQUARE source
// bbox through the REAL conformal map (drosteUV + drosteForward from src/), and
// emit an SVG. Goal: confirm the grid becomes a NET (crossing distorted quads),
// not just radial spokes. k=2.5, ccw, copies=1, every line subdivided per-vertex.
import { build } from "esbuild";
import { pathToFileURL } from "node:url";
import { writeFileSync, mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const entry = `
import { drosteUV } from "../src/droste-layout";
import { drosteForward } from "../src/conformal";
import { writeFileSync } from "node:fs";

// SQUARE source bbox ⇒ uH = 2π·(H/W) = 2π (isotropic). This is the crux: a wide
// bbox shrinks uH, collapses the u(ring) family, and leaves only radial spokes.
const b = { minX: 0, minY: 0, maxX: 1, maxY: 1 };
const p = { k: 2.5, twistDir: 1, R0: 1 }; // ccw; R0 arbitrary, we auto-fit below
const N = 12;     // 12×12 grid
const SUB = 24;   // drosteSubdiv: per-vertex subdivision of each grid line
const m = 0;      // copies=1 ⇒ only m=0

// Map a source point through the exact same pipeline project() uses.
function map(x, y) {
  const { u, v } = drosteUV(b, x, y);
  return drosteForward(u, v + 2 * Math.PI * m, p); // {re, im}
}

const lines = [];
// vertical lines: const X (= const v), Y varies → the radial-ish family
for (let i = 0; i <= N; i++) {
  const x = i / N;
  const pts = [];
  for (let s = 0; s <= SUB; s++) pts.push(map(x, s / SUB));
  lines.push(pts);
}
// horizontal lines: const Y (= const u), X varies → the ring family
for (let j = 0; j <= N; j++) {
  const y = j / N;
  const pts = [];
  for (let s = 0; s <= SUB; s++) pts.push(map(s / SUB, y));
  lines.push(pts);
}

// auto-fit z-bbox into a square canvas
let minRe = Infinity, maxRe = -Infinity, minIm = Infinity, maxIm = -Infinity;
for (const ln of lines) for (const z of ln) {
  if (z.re < minRe) minRe = z.re; if (z.re > maxRe) maxRe = z.re;
  if (z.im < minIm) minIm = z.im; if (z.im > maxIm) maxIm = z.im;
}
const W = 1000, H = 1000, pad = 40;
const spanRe = maxRe - minRe || 1, spanIm = maxIm - minIm || 1;
const sc = Math.min((W - 2 * pad) / spanRe, (H - 2 * pad) / spanIm);
const ox = (W - sc * spanRe) / 2, oy = (H - sc * spanIm) / 2;
const sx = (re) => ox + (re - minRe) * sc;
const sy = (im) => oy + (im - minIm) * sc;

let svg = '<svg xmlns="http://www.w3.org/2000/svg" width="' + W + '" height="' + H + '" style="background:#0f1116">';
for (const ln of lines) {
  const d = ln.map((z, k) => (k ? "L" : "M") + sx(z.re).toFixed(2) + " " + sy(z.im).toFixed(2)).join(" ");
  svg += '<path d="' + d + '" fill="none" stroke="rgba(220,60,60,0.7)" stroke-width="1.3"/>';
}
svg += "</svg>";
writeFileSync("/home/ubuntu/obsidian-plugins/tag-lens/stage1-mesh.svg", svg);
console.log("wrote stage1-mesh.svg :", lines.length, "lines,", (N+1)*2, "grid lines, each", SUB, "segments");
console.log("z-bbox re[", minRe.toFixed(3), maxRe.toFixed(3), "] im[", minIm.toFixed(3), maxIm.toFixed(3), "]");
`;

const result = await build({
	stdin: { contents: entry, resolveDir: join(process.cwd(), "test"), sourcefile: "stage1.ts", loader: "ts" },
	bundle: true, format: "esm", platform: "node", write: false,
});
const dir = mkdtempSync(join(tmpdir(), "stage1-"));
const out = join(dir, "s1.mjs");
writeFileSync(out, result.outputFiles[0].text);
await import(pathToFileURL(out).href);
