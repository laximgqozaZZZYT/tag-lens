// worldTransform(dpr, zoom, panX, panY) — the world→device-pixel setTransform
// 6-tuple: uniform scale dpr*zoom, no shear, translation dpr*pan. Behaviour lock
// for the matrix deduped across the three world-space passes in view.ts draw().
import { worldTransform } from "../src/draw/world-transform";
import { ok } from "./assert";

// dpr = 1, zoom = 1 → identity scale, translation equals the raw pan.
{
	const m = worldTransform(1, 1, 10, 20);
	ok(
		m[0] === 1 && m[1] === 0 && m[2] === 0 && m[3] === 1 && m[4] === 10 && m[5] === 20,
		"dpr 1 / zoom 1 → [1,0,0,1,panX,panY]",
	);
}

// HiDPI + zoom: scale is dpr*zoom on both diagonals, no shear, pan pre-multiplied by dpr.
{
	const m = worldTransform(2, 1.5, 10, 20);
	ok(m[0] === 3 && m[3] === 3, "scale = dpr*zoom on both diagonals");
	ok(m[1] === 0 && m[2] === 0, "no shear/rotation terms");
	ok(m[4] === 20 && m[5] === 40, "translation = dpr*pan");
}

// The tiling loop folds a tile offset into the pan before calling: the scale is
// unchanged and the translation carries the offset, exactly like the inline form
// `dpr * (panX + zoom * offX)`.
{
	const dpr = 2;
	const zoom = 1.5;
	const panX = 10;
	const offX = 4;
	const m = worldTransform(dpr, zoom, panX + zoom * offX, 0);
	ok(m[0] === dpr * zoom, "offset pass keeps scale = dpr*zoom");
	ok(m[4] === dpr * (panX + zoom * offX), "offset folded into translation via pan");
}

// Zero pan → a pure scale about the origin.
{
	const m = worldTransform(2, 2, 0, 0);
	ok(m[0] === 4 && m[3] === 4 && m[4] === 0 && m[5] === 0, "zero pan → pure scale");
}
