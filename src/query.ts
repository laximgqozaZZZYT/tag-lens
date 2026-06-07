// Obsidian-style query parser + evaluator with a single extension: `?` as a
// "partition wildcard". For fields with multiple values (e.g. tags, array
// frontmatter), `?` produces one match INSTANCE per distinct value — so a
// file with tags=[A,B] evaluated against `tag:?` yields two instances, one
// bound to A and one bound to B. Each instance becomes a separate cluster
// membership downstream, enabling Euler-diagram-style overlap rendering.

export type Atom =
	| { kind: "tag"; value: string; depth?: number } // tag name (no #) or "?"; depth = nested level (tagN:)
	| { kind: "fm"; field: string; value: string }; // literal or "?"

export type QueryAst =
	| { kind: "atom"; atom: Atom }
	| { kind: "and"; left: QueryAst; right: QueryAst }
	| { kind: "or"; left: QueryAst; right: QueryAst }
	| { kind: "not"; inner: QueryAst };

export interface FileFacts {
	path: string;
	tags: string[];
	frontmatter: Record<string, unknown>;
}

// Empty `instances` array = no match. A single empty-bindings entry = match
// with no wildcard bindings (e.g. literal `tag:#wip` against a file).
export interface EvalResult {
	instances: Map<string, string>[];
}

// --- Tokenizer ---

type Token =
	| { kind: "atom"; text: string }
	| { kind: "and" }
	| { kind: "or" }
	| { kind: "not" }
	| { kind: "lparen" }
	| { kind: "rparen" };

function tokenize(s: string): Token[] {
	const tokens: Token[] = [];
	let i = 0;
	while (i < s.length) {
		const c = s[i];
		if (c === " " || c === "\t" || c === "\n") {
			i++;
			continue;
		}
		if (c === "(") {
			tokens.push({ kind: "lparen" });
			i++;
			continue;
		}
		if (c === ")") {
			tokens.push({ kind: "rparen" });
			i++;
			continue;
		}
		if (c === "-" && i + 1 < s.length && s[i + 1] !== " " && s[i + 1] !== "\t") {
			tokens.push({ kind: "not" });
			i++;
			continue;
		}
		const start = i;
		while (i < s.length) {
			const ch = s[i];
			if (ch === " " || ch === "\t" || ch === "\n" || ch === "(" || ch === ")") break;
			i++;
		}
		const text = s.slice(start, i);
		const up = text.toUpperCase();
		if (up === "AND") tokens.push({ kind: "and" });
		else if (up === "OR") tokens.push({ kind: "or" });
		else if (up === "NOT") tokens.push({ kind: "not" });
		else tokens.push({ kind: "atom", text });
	}
	return tokens;
}

function parseAtomText(text: string): Atom {
	const colon = text.indexOf(":");
	if (colon < 0) throw new Error(`atom must contain ":": "${text}"`);
	const field = text.slice(0, colon);
	let value = text.slice(colon + 1);
	if (value === "") throw new Error(`empty value in "${text}"`);
	// `*` is accepted as an alias for the `?` partition wildcard so the
	// notation matches glob-style conventions some users expect.
	if (value === "*") value = "?";
	// `tag:` = whole nested path; `tagN:` = first N path segments (hierarchy
	// level), so `tag1:*` clusters by top-level tag and `tag1:Programming`
	// subtree-matches Programming/anything.
	const tagLevel = field.match(/^tag([1-9]\d*)$/);
	if (field === "tag" || tagLevel) {
		if (value !== "?" && value.startsWith("#")) value = value.slice(1);
		return { kind: "tag", value, depth: tagLevel ? Number(tagLevel[1]) : undefined };
	}
	if (field === "folder" || field === "path") {
		throw new Error(`"${field}:" is not supported; use tag:/<frontmatter-field>: only`);
	}
	if (!/^[A-Za-z_][A-Za-z0-9_-]*$/.test(field)) {
		throw new Error(`invalid field name: "${field}"`);
	}
	return { kind: "fm", field, value };
}

class Parser {
	private tokens: Token[];
	private pos = 0;
	constructor(tokens: Token[]) {
		this.tokens = tokens;
	}
	private peek(): Token | undefined {
		return this.tokens[this.pos];
	}
	private consume(): Token | undefined {
		return this.tokens[this.pos++];
	}
	parseExpr(): QueryAst {
		return this.parseOr();
	}
	private parseOr(): QueryAst {
		let left = this.parseAnd();
		while (this.peek()?.kind === "or") {
			this.consume();
			const right = this.parseAnd();
			left = { kind: "or", left, right };
		}
		return left;
	}
	private parseAnd(): QueryAst {
		let left = this.parseUnary();
		while (this.peek()?.kind === "and") {
			this.consume();
			const right = this.parseUnary();
			left = { kind: "and", left, right };
		}
		return left;
	}
	private parseUnary(): QueryAst {
		if (this.peek()?.kind === "not") {
			this.consume();
			return { kind: "not", inner: this.parseUnary() };
		}
		return this.parsePrimary();
	}
	private parsePrimary(): QueryAst {
		const tok = this.consume();
		if (!tok) throw new Error("unexpected end of query");
		if (tok.kind === "lparen") {
			const e = this.parseExpr();
			const close = this.consume();
			if (close?.kind !== "rparen") throw new Error("missing close paren");
			return e;
		}
		if (tok.kind === "atom") {
			return { kind: "atom", atom: parseAtomText(tok.text) };
		}
		throw new Error(`unexpected token: ${tok.kind}`);
	}
	get exhausted(): boolean {
		return this.pos >= this.tokens.length;
	}
}

export function parseQuery(s: string): QueryAst {
	const tokens = tokenize(s);
	if (tokens.length === 0) throw new Error("empty query");
	const p = new Parser(tokens);
	const ast = p.parseExpr();
	if (!p.exhausted) throw new Error("trailing tokens after expression");
	return ast;
}

// --- Evaluator ---

const EMPTY_INSTANCE = (): Map<string, string> => new Map();

// Collapse a nested tag (`A/B/C`) to its first `depth` segments (`A/B`).
// depth undefined → whole tag unchanged.
function tagAtDepth(tag: string, depth?: number): string {
	return depth ? tag.split("/").slice(0, depth).join("/") : tag;
}

function evalAtom(atom: Atom, f: FileFacts): EvalResult {
	if (atom.kind === "tag") {
		const depth = atom.depth;
		if (atom.value === "?") {
			if (f.tags.length === 0) return { instances: [] };
			// Dedupe in case a file has the same tag listed twice (e.g. inline +
			// fm), or two tags share a prefix at this depth.
			const seen = new Set<string>();
			const instances: Map<string, string>[] = [];
			for (const t of f.tags) {
				const key = tagAtDepth(t, depth);
				if (seen.has(key)) continue;
				seen.add(key);
				instances.push(new Map([["tag", key]]));
			}
			return { instances };
		}
		const hit = depth != null
			? f.tags.some((t) => tagAtDepth(t, depth) === atom.value)
			: f.tags.includes(atom.value);
		return { instances: hit ? [EMPTY_INSTANCE()] : [] };
	}
	// frontmatter
	const fmValue = f.frontmatter[atom.field];
	if (atom.value === "?") {
		if (fmValue == null || fmValue === "") return { instances: [] };
		if (Array.isArray(fmValue)) {
			const seen = new Set<string>();
			const instances: Map<string, string>[] = [];
			for (const v of fmValue) {
				const s = String(v);
				if (!s || seen.has(s)) continue;
				seen.add(s);
				instances.push(new Map([[atom.field, s]]));
			}
			return { instances };
		}
		return { instances: [new Map([[atom.field, String(fmValue)]])] };
	}
	if (Array.isArray(fmValue)) {
		return {
			instances: fmValue.some((x) => String(x) === atom.value) ? [EMPTY_INSTANCE()] : [],
		};
	}
	return {
		instances: String(fmValue ?? "") === atom.value ? [EMPTY_INSTANCE()] : [],
	};
}

function mergeBindings(a: Map<string, string>, b: Map<string, string>): Map<string, string> {
	const m = new Map(a);
	for (const [k, v] of b) if (!m.has(k)) m.set(k, v);
	return m;
}

export function evalQuery(ast: QueryAst, f: FileFacts): EvalResult {
	if (ast.kind === "atom") return evalAtom(ast.atom, f);
	if (ast.kind === "and") {
		const l = evalQuery(ast.left, f);
		if (l.instances.length === 0) return { instances: [] };
		const r = evalQuery(ast.right, f);
		if (r.instances.length === 0) return { instances: [] };
		const out: Map<string, string>[] = [];
		for (const li of l.instances) {
			for (const ri of r.instances) out.push(mergeBindings(li, ri));
		}
		return { instances: out };
	}
	if (ast.kind === "or") {
		const l = evalQuery(ast.left, f);
		const r = evalQuery(ast.right, f);
		return { instances: [...l.instances, ...r.instances] };
	}
	// not — bindings from the inner expression are discarded.
	const inner = evalQuery(ast.inner, f);
	return { instances: inner.instances.length === 0 ? [EMPTY_INSTANCE()] : [] };
}

export function isMatched(r: EvalResult): boolean {
	return r.instances.length > 0;
}

// Substitute `$<field>` placeholders in a label string with bound values.
// Unknown placeholders are left as-is.
export function substituteLabel(template: string, bindings: Map<string, string>): string {
	return template.replace(/\$([A-Za-z_][A-Za-z0-9_-]*)/g, (m: string, name: string) => {
		return bindings.get(name) ?? m;
	});
}
