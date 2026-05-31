// Droste "log grid" tile — generated PROCEDURALLY at runtime (no embedded asset).
// It is a square grid carried by the complex exponential: at tile coord (s, ang) the
// plane point is P = e^{2π·s}·(cos ang, sin ang) and we draw grid lines where
// log(|Re P|) and log(|Im P|) hit a lattice. The log|·| is softened with +EPS so the
// four coordinate-axis accumulations don't blow up into streaks. Sampling this tile at
// w = (1−i)·log(z)/2π (with wrap-around) turns it into the Print Gallery spiral grid:
// a net of distorted quads nesting self-similarly into a central singularity.
// Self-generated from math — not derived from any external image.
export const GRID_TEX = {
	width: 512,
	height: 572, // ≈ width · (566/507) so the tile aspect matches the sampler's yPeriod
	yPeriod: 566 / 507,
};

const G = 8; // grid cells per tile unit
const EPS = 0.2; // softens log(|cos|),log(|sin|) at the axes → no streak accumulations
const LW = 0.09; // half line width in cell units
const SS = 2; // supersampling for anti-aliasing

let _cache: Uint8Array | null = null;

// 8-bit luminance map (0 = grid line, 255 = background), generated once and cached.
export function decodeGridTex(): Uint8Array {
	if (_cache) return _cache;
	const TW = GRID_TEX.width, TH = GRID_TEX.height, yP = GRID_TEX.yPeriod;
	const lum = new Uint8Array(TW * TH);
	for (let j = 0; j < TH; j++) {
		for (let i = 0; i < TW; i++) {
			let on = 0;
			for (let sy = 0; sy < SS; sy++) {
				for (let sx = 0; sx < SS; sx++) {
					const s = (i + (sx + 0.5) / SS) / TW;
					const t = ((j + (sy + 0.5) / SS) / TH) * yP;
					const ang = (2 * Math.PI * t) / yP;
					const R = 2 * Math.PI * s; // log|P| = 2π·s
					const a = (R + Math.log(Math.abs(Math.cos(ang)) + EPS)) / (2 * Math.PI) * G;
					const b = (R + Math.log(Math.abs(Math.sin(ang)) + EPS)) / (2 * Math.PI) * G;
					const da = Math.abs(a - Math.round(a));
					const db = Math.abs(b - Math.round(b));
					if (Math.min(da, db) < LW) on++;
				}
			}
			lum[j * TW + i] = Math.round(255 * (1 - on / (SS * SS)));
		}
	}
	_cache = lum;
	return lum;
}
