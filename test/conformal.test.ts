import { approx } from "./assert";
import { drosteForward, drosteInverseBranch, subdivideSegment, type DrosteParams } from "../src/layout/conformal";

const P: DrosteParams = { k: 2.5, twistDir: 1, R0: 100 };

// Round-trip: inverse(forward(u,v)) ≈ (u,v) for the matching branch.
for (const [u, v] of [[0.3, 0.5], [-1.2, 4.0], [2.0, 6.0]] as const) {
	const z = drosteForward(u, v, P);
	// forward used arg in (−π,π]; pick branch n so vRaw lands near v.
	const n = Math.round((v - drosteInverseBranch(z, P, 0).vRaw) / (2 * Math.PI));
	const back = drosteInverseBranch(z, P, n);
	approx(back.u, u, 1e-9, `round-trip u (u=${u},v=${v})`);
	approx(back.vRaw, v, 1e-9, `round-trip v (u=${u},v=${v})`);
}

// Scale periodicity: one loop (+2π in v) multiplies |z| by k^twistDir.
// Independent of round-trip — a wrong-but-consistent map can pass round-trip.
for (const twistDir of [1, -1] as const) {
	const Q: DrosteParams = { k: 2.5, twistDir, R0: 100 };
	for (const [u, v] of [[0.2, 0.0], [-1.0, 1.3], [3.0, 5.5]] as const) {
		const z0 = drosteForward(u, v, Q);
		const z1 = drosteForward(u, v + 2 * Math.PI, Q);
		const ratio = Math.hypot(z1.re, z1.im) / Math.hypot(z0.re, z0.im);
		approx(ratio, Math.pow(Q.k, twistDir), 1e-9,
			`scale ×k per loop (twist=${twistDir}, u=${u}, v=${v})`);
		// Angle closure: arg advances by exactly 2π over one loop (Re(γ)=1).
		const a0 = Math.atan2(z0.im, z0.re);
		const a1 = Math.atan2(z1.im, z1.re);
		const d = ((a1 - a0) % (2 * Math.PI) + 2 * Math.PI) % (2 * Math.PI);
		approx(Math.min(d, 2 * Math.PI - d), 0, 1e-9,
			`angle closes mod 2π (twist=${twistDir}, u=${u}, v=${v})`);
	}
}

{
	const pts = subdivideSegment({ u: 0, v: 0 }, { u: 1, v: 2 }, 4);
	approx(pts.length, 5, 0, "subdivide n=4 yields n+1 points");
	approx(pts[0].u, 0, 1e-12, "first point = start");
	approx(pts[4].v, 2, 1e-12, "last point = end");
	approx(pts[2].u, 0.5, 1e-12, "midpoint u interpolated");
	approx(pts[2].v, 1.0, 1e-12, "midpoint v interpolated");
}
