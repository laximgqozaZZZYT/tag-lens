// F3-1 — Canvas2D→SVG recorder. Verifies that the subset of the 2D API used by
// src/draw/* produces well-formed, faithful SVG: baked transforms, clip groups,
// dashes, text anchors/baselines, and XML escaping.
import { ok } from "./assert";
import { SvgRecorderContext } from "../src/visual/svg-recorder";

// A deterministic stand-in for measureText (real width needs no DOM here).
const measure = (t: string, _font: string) => t.length * 6;

function mk(w = 100, h = 80) {
	return new SvgRecorderContext(w, h, measure);
}

// Root <svg> carries the canvas dimensions + viewBox.
{
	const ctx = mk(120, 90);
	const svg = ctx.toSvg();
	ok(svg.startsWith("<svg "), "starts with <svg");
	ok(svg.includes('width="120"') && svg.includes('height="90"'), "width/height present");
	ok(svg.includes('viewBox="0 0 120 90"'), "viewBox matches canvas");
	ok(svg.endsWith("</svg>"), "closes </svg>");
}

// fillRect emits a baked polygon path with the current fillStyle.
{
	const ctx = mk();
	ctx.fillStyle = "#ff0000";
	ctx.fillRect(10, 20, 30, 40);
	const svg = ctx.toSvg();
	ok(svg.includes('fill="#ff0000"'), "fillStyle applied");
	ok(svg.includes("M10 20L40 20L40 60L10 60Z"), "rect corners baked (got: " + svg + ")");
}

// translate + scale bake into absolute coordinates.
{
	const ctx = mk();
	ctx.setTransform(2, 0, 0, 2, 5, 5); // scale 2, translate (5,5) in device space
	ctx.beginPath();
	ctx.moveTo(0, 0);
	ctx.lineTo(10, 0);
	ctx.stroke();
	const svg = ctx.toSvg();
	// (0,0)->(5,5); (10,0)->(25,5)
	ok(svg.includes("M5 5L25 5"), "points baked through CTM (got: " + svg + ")");
	// lineWidth (default 1) scaled by factor 2
	ok(svg.includes('stroke-width="2"'), "stroke-width scaled by CTM (got: " + svg + ")");
}

// save/restore isolates transform + style.
{
	const ctx = mk();
	ctx.save();
	ctx.translate(100, 100);
	ctx.fillStyle = "#abc";
	ctx.restore();
	ctx.fillStyle = "#111111";
	ctx.fillRect(0, 0, 1, 1);
	const svg = ctx.toSvg();
	ok(svg.includes('fill="#111111"'), "fillStyle restored");
	ok(svg.includes("M0 0L1 0L1 1L0 1Z"), "transform restored (no +100 offset)");
}

// clip() wraps subsequent output in a <g clip-path> closed by restore().
{
	const ctx = mk();
	ctx.save();
	ctx.beginPath();
	ctx.rect(0, 0, 50, 50);
	ctx.clip();
	ctx.fillStyle = "#222";
	ctx.fillRect(10, 10, 5, 5);
	ctx.restore();
	ctx.fillStyle = "#333";
	ctx.fillRect(60, 60, 5, 5); // outside the clip group
	const svg = ctx.toSvg();
	ok(svg.includes("<clipPath id="), "clipPath defined");
	ok(/<g clip-path="url\(#tlc\d+\)">.*fill="#222".*<\/g>/.test(svg), "clipped fill inside group (got: " + svg + ")");
	ok(svg.indexOf('fill="#333"') > svg.indexOf("</g>"), "post-restore fill is outside the group");
}

// dashes scale with the CTM and land on the stroke.
{
	const ctx = mk();
	ctx.setLineDash([4, 2]);
	ctx.beginPath();
	ctx.moveTo(0, 0);
	ctx.lineTo(10, 10);
	ctx.stroke();
	const svg = ctx.toSvg();
	ok(svg.includes('stroke-dasharray="4,2"'), "dash array present (got: " + svg + ")");
	ok(ctx.getLineDash().length === 2, "getLineDash round-trips");
}

// text: anchor + baseline mapping, font parsing, transform, XML escaping.
{
	const ctx = mk();
	ctx.font = "700 13px sans-serif";
	ctx.textAlign = "center";
	ctx.textBaseline = "middle";
	ctx.fillStyle = "#000";
	ctx.fillText("a & b <x>", 12, 34);
	const svg = ctx.toSvg();
	ok(svg.includes("<text "), "text emitted");
	ok(svg.includes('text-anchor="middle"'), "center→middle anchor");
	ok(svg.includes('dominant-baseline="central"'), "middle→central baseline");
	ok(svg.includes('font-weight="700"'), "weight parsed");
	ok(svg.includes('font-size="13"'), "size parsed");
	ok(svg.includes("a &amp; b &lt;x&gt;"), "text XML-escaped (got: " + svg + ")");
	ok(svg.includes("transform=\"matrix(1,0,0,1,0,0)\""), "identity transform emitted");
}

// rotated text carries the rotation in its transform matrix.
{
	const ctx = mk();
	ctx.save();
	ctx.translate(50, 50);
	ctx.rotate(-Math.PI / 2);
	ctx.fillText("L", 0, 0);
	ctx.restore();
	const svg = ctx.toSvg();
	// matrix for translate(50,50)·rotate(-90°) = [0,-1,1,0,50,50]
	ok(/transform="matrix\(0,-1,1,0,50,50\)"/.test(svg), "rotated text matrix (got: " + svg + ")");
}

// full-circle arc → fill path with two arc segments.
{
	const ctx = mk();
	ctx.beginPath();
	ctx.arc(20, 20, 5, 0, Math.PI * 2);
	ctx.fill();
	const svg = ctx.toSvg();
	ok((svg.match(/A5 5 /g) || []).length === 2, "circle = two semicircle arcs (got: " + svg + ")");
}

// globalAlpha becomes opacity.
{
	const ctx = mk();
	ctx.globalAlpha = 0.5;
	ctx.fillRect(0, 0, 1, 1);
	ok(ctx.toSvg().includes('opacity="0.5"'), "globalAlpha→opacity");
}

// ctx.canvas stand-in exposes dimensions for draw().
{
	const ctx = mk(640, 480);
	ok(ctx.canvas.width === 640 && ctx.canvas.height === 480, "canvas dims exposed");
}
