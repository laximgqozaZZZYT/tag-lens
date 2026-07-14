// undirectedPairKey(a, b) — the dictionary-ordered `a|b` key that makes an
// unordered id pair collapse to one string regardless of argument order.
// The ghost-edge linked-pair set (view.ts) and the bridge-finder seen-pair
// guard both keyed on this identical inline idiom; now one pure helper.
import { ok } from "./assert";
import { undirectedPairKey } from "../src/util/pair-key";

// Dictionary order: the lexically-smaller id leads, joined with `|`.
{
	ok(undirectedPairKey("a", "b") === "a|b", "smaller-first stays a|b");
	ok(undirectedPairKey("b", "a") === "a|b", "larger-first still a|b (order-independent)");
}

// Argument order never changes the key — the whole point of the helper.
{
	ok(
		undirectedPairKey("notes/x.md", "notes/y.md") ===
			undirectedPairKey("notes/y.md", "notes/x.md"),
		"the two argument orders produce the same key",
	);
}

// Equal ids → both halves are the same id.
{
	ok(undirectedPairKey("a", "a") === "a|a", "self-pair keeps both halves");
}

// Lexical (not numeric) ordering, matching the original inline `<` comparison.
{
	ok(undirectedPairKey("10", "9") === "10|9", "lexical order: '10' < '9'");
	ok(undirectedPairKey("9", "10") === "10|9", "same lexical key from the flipped order");
}
