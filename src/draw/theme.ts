// Theme-aware colour resolution for the canvas renderer.
//
// The DOM panels (styles.css) already follow Obsidian via CSS variables, but
// Canvas 2D cannot read `var(--…)` — it needs concrete colour strings. This
// module resolves Obsidian's theme variables once (getComputedStyle), anchors
// every derived colour to the base background luminance (`baseLum`), and hands
// the renderer a flat `ThemeTokens` bag. `swatch()` keeps each cluster's hue
// (its identity) while choosing a lightness that stays legible against the
// current base colour — light, dark, or a custom grey/sepia theme.
//
// resolveTheme(el) is re-run on Obsidian's `css-change` event so the view
// follows live theme switches.

export type SwatchRole =
	| "fill" // ordinary cluster fill
	| "fillStrong" // emphasised fill (hover / selection)
	| "stroke" // outlines, edges
	| "dim" // inactive / receded fill
	| "label" // text drawn on top of a shape
	| "tint"; // region background (closest to base)

export interface ThemeTokens {
	isDark: boolean; // baseLum < 0.5 (convenience flag)
	baseLum: number; // relative luminance of --background-primary (0..1) — the anchor
	// chrome (concrete colour strings)
	canvasBg: string;
	canvasBgAlt: string;
	panelBg: string;
	border: string;
	borderStrong: string;
	textNormal: string;
	textMuted: string;
	textFaint: string;
	accent: string;
	accentText: string;
	hover: string;
	danger: string;
	warn: string;
	success: string;
	// categorical identity colour: hue preserved, lightness anchored to baseLum
	swatch(hue: number, role: SwatchRole, alpha?: number): string;
	// subtle contrast overlay (hairlines, hover washes): white on a dark base,
	// black on a light base, so it stays visible whichever way the theme goes.
	overlay(alpha: number): string;
}

export interface RGB {
	r: number;
	g: number;
	b: number;
}

// --- colour parsing -----------------------------------------------------

export function parseColor(input: string): RGB | null {
	if (!input) return null;
	const s = input.trim();

	const hex = s.match(/^#([0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/);
	if (hex) {
		let h = hex[1];
		if (h.length === 3) h = h[0] + h[0] + h[1] + h[1] + h[2] + h[2];
		return {
			r: parseInt(h.slice(0, 2), 16),
			g: parseInt(h.slice(2, 4), 16),
			b: parseInt(h.slice(4, 6), 16),
		};
	}

	const rgb = s.match(/^rgba?\(\s*([\d.]+)[\s,]+([\d.]+)[\s,]+([\d.]+)/i);
	if (rgb) {
		return {
			r: Math.round(parseFloat(rgb[1])),
			g: Math.round(parseFloat(rgb[2])),
			b: Math.round(parseFloat(rgb[3])),
		};
	}

	return null;
}

// --- relative luminance (WCAG sRGB) ------------------------------------

export function relativeLuminance({ r, g, b }: RGB): number {
	const lin = (c: number) => {
		const x = c / 255;
		return x <= 0.03928 ? x / 12.92 : Math.pow((x + 0.055) / 1.055, 2.4);
	};
	return 0.2126 * lin(r) + 0.7152 * lin(g) + 0.0722 * lin(b);
}

// --- categorical swatch generator --------------------------------------

// Per-role lightness offset from the base and saturation. `off` is how far the
// role pushes away from baseLum toward the contrasting end — it doubles as the
// minimum contrast the role guarantees. Saturation is base-independent so hues
// stay distinguishable across themes.
const ROLE: Record<SwatchRole, { off: number; s: number }> = {
	fill: { off: 0.42, s: 60 },
	fillStrong: { off: 0.52, s: 72 },
	stroke: { off: 0.46, s: 62 },
	dim: { off: 0.16, s: 25 },
	label: { off: 0.5, s: 55 },
	tint: { off: 0.05, s: 30 },
};

const clamp = (x: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, x));

export function makeSwatch(baseLum: number): ThemeTokens["swatch"] {
	const dir = baseLum < 0.5 ? 1 : -1; // dark base → lighter; light base → darker
	return (hue: number, role: SwatchRole, alpha?: number): string => {
		const spec = ROLE[role] ?? ROLE.fill;
		const l = clamp(baseLum + dir * spec.off, 0.04, 0.96) * 100;
		return alpha == null
			? `hsl(${hue}, ${spec.s}%, ${l}%)`
			: `hsla(${hue}, ${spec.s}%, ${l}%, ${alpha})`;
	};
}

// Apply an alpha to an already-resolved colour string (hex / rgb / rgba),
// returning rgba(...). Used to give theme tokens a translucent variant (glows,
// washes, dim lines) while keeping them anchored to the theme. Unparseable
// input is returned unchanged so it still renders.
export function colorAlpha(color: string, alpha: number): string {
	const rgb = parseColor(color);
	if (!rgb) return color;
	return `rgba(${rgb.r}, ${rgb.g}, ${rgb.b}, ${alpha})`;
}

export function makeOverlay(baseLum: number): ThemeTokens["overlay"] {
	const c = baseLum < 0.5 ? "255, 255, 255" : "0, 0, 0";
	return (alpha: number): string => `rgba(${c}, ${alpha})`;
}

// --- theme resolution from the DOM -------------------------------------

// Dark-theme fallbacks mirror the renderer's historical hardcoded values so a
// missing variable never breaks rendering.
const FALLBACK = {
	canvasBg: "#0f1116",
	canvasBgAlt: "#161c2a",
	panelBg: "#1a1d24",
	border: "#2a3447",
	borderStrong: "#3a4760",
	textNormal: "#e6edf3",
	textMuted: "#9db4d6",
	textFaint: "#5b6678",
	accent: "#2d6cdf",
	accentText: "#ffffff",
	hover: "rgba(255,255,255,0.06)",
	danger: "#f87171",
	warn: "#fbbf24",
	success: "#34d399",
};

// Shift a colour toward white (dL>0) or black (dL<0) by |dL| — used to derive
// chrome tokens (borders, alt backgrounds) when Obsidian exposes no dedicated
// variable, keeping them anchored to the base colour.
function shade(c: RGB, dL: number): string {
	const mix = dL >= 0
		? (v: number) => Math.round(v + (255 - v) * dL)
		: (v: number) => Math.round(v * (1 + dL));
	return `rgb(${mix(c.r)}, ${mix(c.g)}, ${mix(c.b)})`;
}

// Build a DOM-free default (dark fallback) so the renderer has a valid theme
// before the first resolveTheme() and in non-DOM contexts (tests).
export function defaultTheme(): ThemeTokens {
	const baseRGB = parseColor(FALLBACK.canvasBg) ?? { r: 15, g: 17, b: 22 };
	const baseLum = relativeLuminance(baseRGB);
	return {
		isDark: baseLum < 0.5,
		baseLum,
		canvasBg: FALLBACK.canvasBg,
		canvasBgAlt: FALLBACK.canvasBgAlt,
		panelBg: FALLBACK.panelBg,
		border: FALLBACK.border,
		borderStrong: FALLBACK.borderStrong,
		textNormal: FALLBACK.textNormal,
		textMuted: FALLBACK.textMuted,
		textFaint: FALLBACK.textFaint,
		accent: FALLBACK.accent,
		accentText: FALLBACK.accentText,
		hover: FALLBACK.hover,
		danger: FALLBACK.danger,
		warn: FALLBACK.warn,
		success: FALLBACK.success,
		swatch: makeSwatch(baseLum),
		overlay: makeOverlay(baseLum),
	};
}

// Module-level "current theme". The view sets it (setTheme) after resolving
// from the DOM and on every `css-change`; draw modules read it via theme().
// Safe because rendering is synchronous and single-threaded: the theme is set
// before each draw pass, never mutated mid-draw.
let _current: ThemeTokens = defaultTheme();
export function setTheme(t: ThemeTokens): void {
	_current = t;
}
export function theme(): ThemeTokens {
	return _current;
}

export function resolveTheme(el: HTMLElement): ThemeTokens {
	const cs = getComputedStyle(el);
	const read = (name: string, fallback: string): string => {
		const v = cs.getPropertyValue(name).trim();
		return v || fallback;
	};

	const canvasBg = read("--background-primary", FALLBACK.canvasBg);
	const baseRGB = parseColor(canvasBg) ?? { r: 15, g: 17, b: 22 };
	const baseLum = relativeLuminance(baseRGB);
	const isDark = baseLum < 0.5;

	// When Obsidian lacks a dedicated variable, derive from the base colour so
	// the whole canvas stays anchored to the user's base colour.
	const borderShade = isDark ? 0.22 : -0.18;

	return {
		isDark,
		baseLum,
		canvasBg,
		canvasBgAlt: read("--background-secondary", shade(baseRGB, isDark ? 0.05 : -0.04)),
		panelBg: read("--background-secondary", FALLBACK.panelBg),
		border: read("--background-modifier-border", shade(baseRGB, borderShade)),
		borderStrong: read("--background-modifier-border-hover", shade(baseRGB, isDark ? 0.34 : -0.3)),
		textNormal: read("--text-normal", FALLBACK.textNormal),
		textMuted: read("--text-muted", FALLBACK.textMuted),
		textFaint: read("--text-faint", FALLBACK.textFaint),
		accent: read("--interactive-accent", FALLBACK.accent),
		accentText: read("--text-on-accent", FALLBACK.accentText),
		hover: read("--background-modifier-hover", FALLBACK.hover),
		danger: read("--color-red", FALLBACK.danger),
		warn: read("--color-yellow", FALLBACK.warn),
		success: read("--color-green", FALLBACK.success),
		swatch: makeSwatch(baseLum),
		overlay: makeOverlay(baseLum),
	};
}
