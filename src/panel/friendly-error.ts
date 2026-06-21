// Display-layer ONLY translation of the SQL-like query parser's technical
// error strings into plain-language hints for non-technical users.
//
// IMPORTANT: This is a pure presentation helper. It NEVER mutates the raw
// error strings stored in settings / surfaced by the parser (query.ts,
// query-filters.ts, limit.ts). Callers run the raw string through
// `friendlyError()` immediately before painting it into the DOM. The parser's
// semantics, return values and thrown messages are unchanged.
//
// Unknown / unmapped errors fall back to the ORIGINAL technical string so no
// diagnostic information is ever swallowed.

// Each rule matches a substring/regex of the raw parser error and produces a
// beginner-friendly replacement. Order matters: first match wins. Patterns are
// anchored on the stable, distinctive part of each thrown message so that the
// embedded user input (which varies) does not break matching.
interface FriendlyRule {
	test: RegExp;
	message: string;
}

const RULES: FriendlyRule[] = [
	// query.ts — atom must contain ":"
	{
		test: /atom must contain ":"/i,
		message: 'Each condition needs a colon, like tag:example.',
	},
	// query.ts — empty value in "..."
	{
		test: /empty value in/i,
		message: 'Add a value after the colon, like tag:example.',
	},
	// query.ts — "<field>:" is not supported; use tag:/<frontmatter-field>:
	{
		test: /is not supported; use tag/i,
		message: 'Use tag: or a frontmatter property name, like status:draft.',
	},
	// query.ts — invalid field name
	{
		test: /invalid field name/i,
		message: 'That property name has characters that are not allowed. Try a simple name like status.',
	},
	// query.ts — empty query
	{
		test: /empty query/i,
		message: 'This condition is empty. Type something like tag:example.',
	},
	// query.ts — missing close paren
	{
		test: /missing close paren/i,
		message: 'A closing parenthesis ")" is missing.',
	},
	// query.ts — unexpected end of query
	{
		test: /unexpected end of query/i,
		message: 'The condition looks unfinished. Try something like tag:example.',
	},
	// query.ts — trailing tokens after expression
	{
		test: /trailing tokens after expression/i,
		message: 'There is extra text after the condition. Check for a stray word or symbol.',
	},
	// query.ts — unexpected token
	{
		test: /unexpected token/i,
		message: 'Something here is not understood. Try a condition like tag:example AND status:draft.',
	},
	// query-filters.ts — expected "count <op> <value>"
	{
		test: /expected "count <op> <value>"/i,
		message: 'This should look like: count >= 3',
	},
	// query-filters.ts — unknown aggregate
	{
		test: /unknown aggregate/i,
		message: 'Only "count" is supported here, like: count >= 3',
	},
	// query-filters.ts — unsupported expression in HAVING
	{
		test: /unsupported expression in HAVING/i,
		message: 'This should look like: count >= 3',
	},
	// query-filters.ts — unknown operator
	{
		test: /unknown operator/i,
		message: 'Use a comparison like >=, >, <=, <, or =, for example: count >= 3',
	},
	// limit.ts — LIMIT row: expected "limit N" or "brief N"
	{
		test: /LIMIT row: expected/i,
		message: 'This should look like: limit 10',
	},
];

// Translate a raw parser error string to a plain-language hint. Returns the
// ORIGINAL string unchanged when no rule matches (fail-open: never hide info).
// Empty / falsy input is returned as-is.
export function friendlyError(raw: string): string {
	if (!raw) return raw;
	for (const rule of RULES) {
		if (rule.test.test(raw)) return rule.message;
	}
	return raw;
}
