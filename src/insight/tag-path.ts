// Pure validation helper for Obsidian tag names used as file-path sinks.
// No Obsidian imports — keeps this unit-testable in a plain Node environment.

// One tag segment (the part between `/` separators). Multilingual + emoji:
//   \p{L}\p{N}\p{M}            letters (any script), numbers, combining marks
//   _ -                        word joiners Obsidian allows
//   \p{Extended_Pictographic}  actual emoji glyphs (NOT \p{Emoji}, which also
//                              matches 0-9 # * — a well-known footgun)
//   \p{Emoji_Modifier}         skin-tone modifiers (👍🏽)
//   \p{Regional_Indicator}     flag pairs (🇯🇵)
//   \u{FE0F}                   variation selector-16 (emoji presentation, 🏷️)
//   \u{200D}                   zero-width joiner for emoji sequences (👨‍👩‍👧)
// Only U+200D is whitelisted among format chars (\p{Cf}); BiDi controls
// (U+202A-202E, U+2066-2069) stay outside the class and remain rejected.
const TAG_SEGMENT =
	"[\\p{L}\\p{N}\\p{M}_\\-\\p{Extended_Pictographic}\\p{Emoji_Modifier}\\p{Regional_Indicator}\\u{FE0F}\\u{200D}]+";
const TAG_NAME_RE = new RegExp(`^${TAG_SEGMENT}(\\/${TAG_SEGMENT})*$`, "u");

/**
 * Returns true when `tag` is a safe, Obsidian-compatible nested tag name.
 *
 * Multilingual + emoji by design: tag segments may use letters from ANY script
 * (Japanese, Cyrillic, Arabic, Thai, Devanagari, Greek, accented Latin, …),
 * digits, combining marks, emoji (incl. ZWJ sequences / skin tones / flags),
 * plus `_` and `-`. `/` is the only segment separator (e.g. "親/子", "🏷️/重要").
 *
 * Explicitly rejected (path-injection guard):
 *   - Empty string or whitespace-only
 *   - Any control character or NUL (\x00-\x1f) and BiDi/format controls except
 *     ZWJ — RLO U+202E etc. are outside the allowed class
 *   - Backslash, and slash confusables (fullwidth `／`, fraction/division slash)
 *     — \p{P}/\p{S}, also outside the allowed class
 *   - Absolute-path indicator at the start (`/`), trailing/empty segments
 *   - Leading dot (`.hidden`) and `..` component anywhere (path traversal):
 *     `.` is punctuation, never in the allowed class
 */
export function isValidTagName(tag: string): boolean {
	// Reject empty / whitespace-only
	if (!tag || tag.trim().length === 0) return false;

	// Reject ASCII control characters and NUL up front (defense in depth; the
	// Unicode class below would already exclude them).
	// eslint-disable-next-line no-control-regex
	if (/[\x00-\x1f]/.test(tag)) return false;

	return TAG_NAME_RE.test(tag);
}
