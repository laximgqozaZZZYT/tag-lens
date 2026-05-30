// Droste / Escher "Print Gallery" conformal map, strip→plane parametrisation.
//   ζ = u + i·v,  z = R₀·exp(γ·ζ),  γ = 1 − i·twistDir·(ln k)/(2π)
// See docs/superpowers/specs/2026-05-30-droste-bubblesets-design.md §2.
export interface Complex {
	re: number;
	im: number;
}

export interface DrosteParams {
	k: number; // scale factor per loop (drosteZoom), > 1
	twistDir: 1 | -1; // +1 ccw (|z| ×k per +2π in v), -1 cw
	R0: number; // base radius
}

function gammaIm(p: DrosteParams): number {
	// Im(γ) = −twistDir·(ln k)/(2π); Re(γ) = 1 (angle closure).
	return -p.twistDir * Math.log(p.k) / (2 * Math.PI);
}

// Forward: strip (u, v) → plane z. ζ = u + i·v.
export function drosteForward(u: number, v: number, p: DrosteParams): Complex {
	const gRe = 1;
	const gIm = gammaIm(p);
	// γ·ζ = (gRe·u − gIm·v) + i(gRe·v + gIm·u)
	const aRe = gRe * u - gIm * v;
	const aIm = gRe * v + gIm * u;
	const r = p.R0 * Math.exp(aRe);
	return { re: r * Math.cos(aIm), im: r * Math.sin(aIm) };
}

// Inverse on a chosen log branch n: ζ = ln(z/R₀)/γ with arg shifted by 2π·n.
// The map is 2πi-periodic, so a screen point has one (u, vRaw) per branch n;
// the renderer's drawn copies correspond to a contiguous range of n.
export function drosteInverseBranch(
	z: Complex,
	p: DrosteParams,
	n: number,
): { u: number; vRaw: number } {
	const gRe = 1;
	const gIm = gammaIm(p);
	const mag = Math.hypot(z.re, z.im) / p.R0;
	const wRe = Math.log(mag);
	const wIm = Math.atan2(z.im, z.re) + 2 * Math.PI * n;
	// ζ = w/γ = w·conj(γ)/|γ|²
	const g2 = gRe * gRe + gIm * gIm;
	const u = (wRe * gRe + wIm * gIm) / g2;
	const vRaw = (wIm * gRe - wRe * gIm) / g2;
	return { u, vRaw };
}
