import { approx } from "./assert";
import { drosteForward, drosteInverseBranch, type DrosteParams } from "../src/conformal";

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
