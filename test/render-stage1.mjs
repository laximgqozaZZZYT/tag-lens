// Stage 1 offline verification (v2 — mathvisuals method): INVERSE per-pixel.
// mathvisuals/PrintGallery samples a REPEATING grid texture at w = (re+im·i)·
// log(z)/2π for every OUTPUT pixel z (CindyGL `colorplot` + imagergb repeat->true).
// We replicate that: for each pixel, invert z → ζ via the real conformal.ts
// (drosteInverseBranch), then shade red near integer grid lines of (u,v) tiled by
// du=dv=2π/N. The twist (Im γ ≠ 0) couples ln|z| into the angular coord, so a
// single principal strip tiles the whole plane → dense Droste mesh (not 1 turn).
import { build } from "esbuild";
import { pathToFileURL } from "node:url";
import { writeFileSync, mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const entry = `
import { drosteInverseBranch } from "../src/conformal";
import { writeFileSync } from "node:fs";
import { deflateSync } from "node:zlib";

const W = 800, H = 800;
const argv = process.argv.slice(2);
// geometry (1,-1): coefficient (1-i)·log(z)/2π ⇔ γ = 1+i ⇔ k=e^{2π}, twistDir=-1.
const p = { k: Math.exp(2 * Math.PI), twistDir: -1, R0: 1 };
const CELL = parseFloat(argv[0] ?? "0.18"); // grid spacing in ζ units
const du = CELL, dv = CELL;
const VIEW = parseFloat(argv[1] ?? "3.2");  // world half-extent mapped to the canvas
const LW = parseFloat(argv[2] ?? "0.08");   // half line width in cell units
const OFFX = parseFloat(argv[4] ?? "0");    // world offset of the singularity (left/right)
const OFFY = parseFloat(argv[5] ?? "0");
const OUT = argv[3] ?? "/home/ubuntu/obsidian-plugins/tag-lens/stage1-mesh.png";

const buf = Buffer.alloc(W * H * 4);
const near = (val, step) => { const f = val / step - Math.round(val / step); return Math.abs(f); };
for (let py = 0; py < H; py++) {
  for (let px = 0; px < W; px++) {
    const zx = (px / W * 2 - 1) * VIEW + OFFX;
    const zy = (py / H * 2 - 1) * VIEW + OFFY;
    let r = 15, g = 17, b = 22; // bg #0f1116
    const mag = Math.hypot(zx, zy);
    if (mag > 1e-4) {
      const { u, vRaw } = drosteInverseBranch({ re: zx, im: zy }, p, 0);
      const d = Math.min(near(u, du), near(vRaw, dv)); // distance to nearest line (cell units)
      if (d < LW) {
        const a = 1 - d / LW;           // soft edge
        r = Math.round(15 + (220 - 15) * a);
        g = Math.round(17 + (60 - 17) * a);
        b = Math.round(22 + (60 - 22) * a);
      }
    }
    const o = (py * W + px) * 4;
    buf[o] = r; buf[o + 1] = g; buf[o + 2] = b; buf[o + 3] = 255;
  }
}

// minimal PNG encoder (RGBA, no filter) via zlib
function png(width, height, rgba) {
  const raw = Buffer.alloc((width * 4 + 1) * height);
  for (let y = 0; y < height; y++) {
    raw[y * (width * 4 + 1)] = 0; // filter: none
    rgba.copy(raw, y * (width * 4 + 1) + 1, y * width * 4, (y + 1) * width * 4);
  }
  const idat = deflateSync(raw);
  const crcTable = (() => { const t = []; for (let n = 0; n < 256; n++) { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; t[n] = c >>> 0; } return t; })();
  const crc = (b) => { let c = 0xffffffff; for (let i = 0; i < b.length; i++) c = crcTable[(c ^ b[i]) & 0xff] ^ (c >>> 8); return (c ^ 0xffffffff) >>> 0; };
  const chunk = (type, data) => {
    const len = Buffer.alloc(4); len.writeUInt32BE(data.length, 0);
    const td = Buffer.concat([Buffer.from(type, "ascii"), data]);
    const c = Buffer.alloc(4); c.writeUInt32BE(crc(td), 0);
    return Buffer.concat([len, td, c]);
  };
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0); ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8; ihdr[9] = 6; ihdr[10] = 0; ihdr[11] = 0; ihdr[12] = 0;
  return Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk("IHDR", ihdr), chunk("IDAT", idat), chunk("IEND", Buffer.alloc(0))]);
}
writeFileSync(OUT, png(W, H, buf));
console.log("wrote stage1-mesh.png (inverse per-pixel, geometry 1,-1, cell=" + CELL + ", view±" + VIEW + ", LW=" + LW + ")");
`;

const result = await build({
	stdin: { contents: entry, resolveDir: join(process.cwd(), "test"), sourcefile: "stage1.ts", loader: "ts" },
	bundle: true, format: "esm", platform: "node", write: false,
});
const dir = mkdtempSync(join(tmpdir(), "stage1-"));
const out = join(dir, "s1.mjs");
writeFileSync(out, result.outputFiles[0].text);
await import(pathToFileURL(out).href);
