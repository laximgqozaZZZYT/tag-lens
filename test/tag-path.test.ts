// Validation tests for isValidTagName — path-injection guard in applyGolderClassification.
import { ok } from "./assert";
import { isTagOrSubtag, isValidTagName } from "../src/insight/tag-path";

// --- 正常系 (valid) ---
{
	ok(isValidTagName("tag"),           "simple word tag is valid");
	ok(isValidTagName("parent/child"),  "one-level nested tag is valid");
	ok(isValidTagName("a/b/c"),         "two-level nested tag is valid");
	ok(isValidTagName("with-hyphen"),   "hyphen in tag is valid");
	ok(isValidTagName("num42"),         "digits in tag are valid");
	ok(isValidTagName("under_score"),   "underscore in tag is valid");
	ok(isValidTagName("A/b-2/c_3"),     "mixed segments are valid");
}

// --- 多言語 正常系 (multilingual valid) ---
{
	ok(isValidTagName("タグ"),            "Japanese tag is valid");
	ok(isValidTagName("親/子/孫"),         "Japanese nested tag is valid");
	ok(isValidTagName("проект"),         "Cyrillic tag is valid");
	ok(isValidTagName("مشروع"),          "Arabic tag is valid");
	ok(isValidTagName("โครงการ"),         "Thai tag is valid");
	ok(isValidTagName("café"),           "accented Latin (precomposed) is valid");
	ok(isValidTagName("café"),     "accented Latin (combining mark) is valid");
	ok(isValidTagName("프로젝트/하위"),     "Korean nested tag is valid");
	ok(isValidTagName("Ελληνικά"),       "Greek tag is valid");
}

// --- 絵文字 正常系 (emoji valid; Obsidian allows emoji tags) ---
{
	ok(isValidTagName("✅"),              "single emoji tag is valid");
	ok(isValidTagName("🔥"),              "fire emoji tag is valid");
	ok(isValidTagName("🏷️/重要"),         "VS16 emoji + nested multibyte segment is valid");
	ok(isValidTagName("👍🏽"),            "emoji with skin-tone modifier is valid");
	ok(isValidTagName("👨‍👩‍👧"),          "ZWJ emoji sequence is valid");
	ok(isValidTagName("🇯🇵"),            "regional-indicator flag is valid");
	ok(isValidTagName("done✅/sub"),      "emoji mixed with letters and nesting is valid");
}

// --- 異常系 (invalid) ---
{
	ok(!isValidTagName(""),             "empty string is rejected");
	ok(!isValidTagName("   "),          "whitespace-only is rejected");
	ok(!isValidTagName("../foo"),       "path traversal ../foo is rejected");
	ok(!isValidTagName("/abs"),         "absolute path /abs is rejected");
	ok(!isValidTagName("foo/../bar"),   "mid-path traversal foo/../bar is rejected");
	ok(!isValidTagName(".hidden"),      "leading-dot segment is rejected");
	ok(!isValidTagName("a\0b"),         "NUL character is rejected");
	ok(!isValidTagName("a\\b"),         "backslash is rejected");
	ok(!isValidTagName("has space"),    "space in tag is rejected");
	ok(!isValidTagName("foo/"),         "trailing slash is rejected");
	ok(!isValidTagName("/"),            "bare slash is rejected");
}

// --- 多言語でも防御は維持 (confusables / bidi must still be rejected) ---
{
	ok(!isValidTagName("ファイル／親"),   "fullwidth solidus U+FF0F is rejected (slash confusable)");
	ok(!isValidTagName("a⁄b"),      "fraction slash U+2044 is rejected");
	ok(!isValidTagName("a∕b"),      "division slash U+2215 is rejected");
	ok(!isValidTagName("a‮b"),      "RTL override U+202E (bidi control) is rejected");
	ok(!isValidTagName("親/../子"),       "traversal between multibyte segments is rejected");
	ok(!isValidTagName("タグ\\子"),       "backslash between multibyte segments is rejected");
}

// --- isTagOrSubtag — self-or-nested-descendant match (convertToNestedTag) ---
{
	ok(isTagOrSubtag("foo", "foo"),        "exact match is a hit");
	ok(isTagOrSubtag("foo/bar", "foo"),    "direct child is a hit");
	ok(isTagOrSubtag("foo/bar/baz", "foo"),"deep descendant is a hit");
	ok(isTagOrSubtag("親/子", "親"),         "multibyte child is a hit");

	ok(!isTagOrSubtag("foobar", "foo"),    "bare prefix (no slash) is NOT a hit");
	ok(!isTagOrSubtag("foo", "foo/bar"),   "ancestor is NOT a hit for a deeper target");
	ok(!isTagOrSubtag("other", "foo"),     "unrelated tag is not a hit");
	ok(!isTagOrSubtag("xfoo/bar", "foo"),  "non-prefix sharing a segment is not a hit");

	// `#`-prefixed form (cache.tags entries compare against `#${tag}`)
	ok(isTagOrSubtag("#foo", "#foo"),      "prefixed exact match is a hit");
	ok(isTagOrSubtag("#foo/bar", "#foo"),  "prefixed child is a hit");
	ok(!isTagOrSubtag("#foobar", "#foo"),  "prefixed bare prefix is NOT a hit");
}
