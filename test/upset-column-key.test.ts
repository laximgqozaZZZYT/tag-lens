// upsetColumnKey(signature) — the single source of truth for an UpSet
// intersection column's identity key ("|"-joined sorted signature), shared by
// the layout bucketing pass, the draw-upset highlight match, and the view's
// stale-selection guard so a selected column re-matches (or drops) verbatim
// after a relayout.
import { ok } from "./assert";
import { upsetColumnKey } from "../src/layout/upset-layout";

// Basic "|"-joined form.
ok(upsetColumnKey(["a", "b", "c"]) === "a|b|c", "joins with pipe");
ok(upsetColumnKey(["solo"]) === "solo", "single tag → itself");
ok(upsetColumnKey([]) === "", "empty signature → empty key");

// The "|" separator is the whole point: it must distinguish {ab,c} from
// {a,bc}, which a naive `.join("")` would collide.
ok(upsetColumnKey(["ab", "c"]) === "ab|c", "{ab,c} key");
ok(upsetColumnKey(["a", "bc"]) === "a|bc", "{a,bc} key");
ok(
	upsetColumnKey(["ab", "c"]) !== upsetColumnKey(["a", "bc"]),
	"separator avoids {ab,c}/{a,bc} collision",
);

// Contract stability: the same tags yield the same key every time.
const sig = ["proj", "todo"];
ok(upsetColumnKey(sig) === upsetColumnKey([...sig]), "same tags → same key");

// Order-sensitive by design — callers pass a SORTED signature, so the key
// contract relies on that ordering rather than re-sorting here.
ok(
	upsetColumnKey(["b", "a"]) !== upsetColumnKey(["a", "b"]),
	"key is order-sensitive (callers pre-sort the signature)",
);
