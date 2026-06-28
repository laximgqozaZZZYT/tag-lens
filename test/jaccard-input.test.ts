// Bridge-finder "Min Jaccard similarity" parse/clamp (extracted from
// settings-tabs.ts renderSettingsDisplayTab). Accept only finite numbers in the
// closed [0, 1] range; everything else rejects (→ null) so the view keeps the
// current setting and resets the input box.
import { ok } from "./assert";
import { parseGhostJaccard } from "../src/panel/jaccard-input";

// In-range values (including the 0 and 1 boundaries) are accepted as-is.
{
	ok(parseGhostJaccard("0") === 0, "0 accepted (lower bound)");
	ok(parseGhostJaccard("1") === 1, "1 accepted (upper bound)");
	ok(parseGhostJaccard("0.35") === 0.35, "mid value accepted");
}

// parseFloat tolerance: trailing junk / whitespace still yields the leading number.
{
	ok(parseGhostJaccard("0.50") === 0.5, "0.50 parses to 0.5");
	ok(parseGhostJaccard(" 0.4 ") === 0.4, "leading/trailing space tolerated");
	ok(parseGhostJaccard("0.7abc") === 0.7, "trailing junk after a valid number tolerated");
}

// Out-of-range and non-numeric inputs reject (null), signalling "keep current".
{
	ok(parseGhostJaccard("-0.1") === null, "below 0 rejected");
	ok(parseGhostJaccard("1.5") === null, "above 1 rejected");
	ok(parseGhostJaccard("") === null, "empty string rejected");
	ok(parseGhostJaccard("abc") === null, "non-numeric rejected");
}
