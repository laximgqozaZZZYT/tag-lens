// Spec for the display-layer plain-language error mapper. Verifies known
// technical parser strings map to beginner hints, and that unknown strings fall
// through UNCHANGED (no information loss).
import { ok } from "./assert";
import { friendlyError } from "../src/panel/friendly-error";

// Known parser errors (verbatim shapes from query.ts / query-filters.ts /
// limit.ts) → friendly text.
ok(
	friendlyError('atom must contain ":": "foo"').includes("needs a colon"),
	"friendlyError: missing colon → colon hint",
);
ok(
	friendlyError('empty value in "tag:"').includes("after the colon"),
	"friendlyError: empty value → value hint",
);
ok(
	friendlyError('"x:" is not supported; use tag:/<frontmatter-field>: only').includes("frontmatter"),
	"friendlyError: unsupported field → frontmatter hint",
);
ok(
	friendlyError('invalid field name: "a b"').includes("not allowed"),
	"friendlyError: invalid field name → friendly",
);
ok(friendlyError("empty query").includes("empty"), "friendlyError: empty query");
ok(
	friendlyError("missing close paren").includes(")"),
	"friendlyError: missing paren → paren hint",
);
ok(
	friendlyError("unexpected end of query").includes("unfinished"),
	"friendlyError: unexpected end → unfinished",
);
ok(
	friendlyError("trailing tokens after expression").includes("extra text"),
	"friendlyError: trailing tokens → extra text",
);
ok(
	friendlyError("unexpected token: rparen").includes("not understood"),
	"friendlyError: unexpected token → friendly",
);
ok(
	friendlyError('expected "count <op> <value>", got: "x"') === "This should look like: count >= 3",
	"friendlyError: count expr → count example",
);
ok(
	friendlyError('unknown aggregate "sum" (only "count" supported)').includes("count"),
	"friendlyError: unknown aggregate → count",
);
ok(
	friendlyError('unsupported expression in HAVING: "x"') === "This should look like: count >= 3",
	"friendlyError: HAVING unsupported → count example",
);
ok(
	friendlyError("unknown operator: ~").includes(">="),
	"friendlyError: unknown operator → operator hint",
);
ok(
	friendlyError('LIMIT row: expected "limit N" or "brief N", got: "x"') === "This should look like: limit 10",
	"friendlyError: limit → limit example",
);

// Unknown error → returned verbatim (fail-open).
const unknown = "some brand new error nobody mapped 12345";
ok(friendlyError(unknown) === unknown, "friendlyError: unknown → unchanged");

// Empty / falsy input → unchanged.
ok(friendlyError("") === "", "friendlyError: empty string → empty string");
