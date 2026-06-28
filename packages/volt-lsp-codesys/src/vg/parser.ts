/**
 * VG parser — VG text/token stream → `VgBody` AST.
 *
 * The LSP analogue of the bridge's `Graphical/Vg/VgParser.cs`. Two
 * deliberate differences:
 *
 *  1. **Token-based, span-rich.** It walks the ST lexer's token slice
 *     (the body already lexed by the parser), so every node maps to exact
 *     source spans the LSP needs for hover/definition/coloring. It does
 *     NOT add VG keywords to the global ST lexer (that would break real ST
 *     identifiers named `Set`, `Let`, `Network`, …); instead VG keywords
 *     are recognised contextually here by `isWord`.
 *  2. **Collects diagnostics, never throws.** The bridge refuses a push on
 *     the first malformed line; the editor must show every problem while
 *     you type (§11), so errors accumulate in `VgBody.diagnostics` and the
 *     parser produces a best-effort tree regardless.
 *
 * Like the bridge it parses each network in two passes: a pre-scan finds
 * the `LET` wire names and the EN/ENO enable wires (a line can't be
 * understood in isolation — `en := src` is only an enable binding once we
 * see its `IF en THEN …` guard), then statements are parsed.
 *
 * Spec: `packages/volt-bridge/docs/vg-language.md`.
 */
import { lex } from "../lexer/lexer.js";
import type { Span } from "../lexer/span.js";
import type { Token } from "../lexer/tokens.js";
import { canonicalOperatorSymbol } from "./operators.js";
import type {
	VgArg,
	VgBody,
	VgCore,
	VgDiagnostic,
	VgDiagnosticCode,
	VgLValue,
	VgMods,
	VgName,
	VgNetwork,
	VgOperand,
	VgStatement,
} from "./ast.js";

// VG keywords recognised contextually (NOT added to the ST lexer). Some
// (IF/THEN/END_IF/JMP/RETURN/NOT/SET/AND/OR/XOR/MOD) already arrive as ST
// keyword tokens; the rest as identifiers. `isWord` matches either.
const POU_ENDERS = new Set([
	"END_PROGRAM",
	"END_FUNCTION_BLOCK",
	"END_FUNCTION",
	"END_METHOD",
	"END_ACTION",
	"END_PROPERTY",
	"END_GET",
	"END_SET",
]);

/** True if `tok` is the given VG word (case-insensitive), keyword or identifier. */
function isWord(tok: Token | undefined, word: string): boolean {
	return tok !== undefined && tok.text.toUpperCase() === word.toUpperCase();
}

function isPunctTok(tok: Token | undefined, text: string): boolean {
	return tok !== undefined && tok.kind === "punct" && tok.text === text;
}

const TRIVIA = new Set(["whitespace", "block_comment", "pragma", "eof"]);

const LITERAL_KINDS = new Set([
	"int_lit",
	"real_lit",
	"string_lit",
	"wstring_lit",
	"time_lit",
	"date_lit",
	"tod_lit",
	"datetime_lit",
	"typed_lit",
	"address_lit",
]);

interface Line {
	toks: Token[];
	span: Span;
}

/** Lex VG source text and parse it. Convenience for tests/tools. */
export function parseVgText(src: string): VgBody {
	return parseVgBody(lex(src), src);
}

/**
 * Parse a body's token slice as VG. `source` (when given) lets opaque
 * leaves capture their exact text; otherwise leaf text is reconstructed
 * from tokens.
 */
export function parseVgBody(tokens: Token[], source?: string): VgBody {
	const diagnostics: VgDiagnostic[] = [];
	const lines = groupLines(tokens);
	const networks: VgNetwork[] = [];
	const seenIndices = new Set<number>();

	let cur: NetworkAcc | undefined;
	let ordinal = 0;

	const flush = (closer?: Line): void => {
		if (cur === undefined) return;
		networks.push(buildNetwork(cur, closer, source, diagnostics));
		cur = undefined;
	};

	for (const line of lines) {
		const first = line.toks[0];
		if (first === undefined) continue;

		// A stray POU ender (END_PROGRAM …) can appear if the body slice
		// includes it — ignore it silently.
		if (line.toks.length === 1 && first.keyword !== undefined && POU_ENDERS.has(first.keyword)) {
			continue;
		}

		if (line.toks.length === 1 && isWord(first, "END_NETWORK")) {
			if (cur === undefined) {
				diagnostics.push(diag("VG_PARSE", "END_NETWORK without an open NETWORK block", line.span));
				continue;
			}
			flush(line);
			continue;
		}

		if (isWord(first, "NETWORK")) {
			if (cur !== undefined) {
				diagnostics.push(
					diag("VG_NETWORK_NOT_CLOSED", `network ${cur.index ?? "?"} is not closed by END_NETWORK`, cur.headerSpan),
				);
				flush();
			}
			cur = startNetwork(line, ordinal++, seenIndices, diagnostics);
			continue;
		}

		if (first.kind === "line_comment") {
			// A comment inside a network is a network comment; a leading
			// comment before any network is simply ignored.
			if (cur !== undefined) {
				cur.comments.push({ kind: "comment", text: first.text.replace(/^\/\/\s?/, ""), span: first.span });
			}
			continue;
		}

		if (cur === undefined) {
			diagnostics.push(diag("VG_PARSE", `statement before any NETWORK: ${lineText(line)}`, line.span));
			continue;
		}

		cur.stmtLines.push(stripTrailingSemicolons(line));
	}

	if (cur !== undefined) {
		diagnostics.push(
			diag("VG_NETWORK_NOT_CLOSED", `network ${cur.index ?? "?"} is not closed by END_NETWORK`, cur.headerSpan),
		);
		flush();
	}

	const span = bodySpan(tokens);
	return { kind: "vg_body", networks, diagnostics, span };
}

// ─── Network assembly ────────────────────────────────────────────────

interface NetworkAcc {
	index?: number;
	indexToken?: Token;
	language: string;
	languageToken?: Token;
	label?: string;
	disabled: boolean;
	comments: VgNetwork["comments"];
	headerSpan: Span;
	stmtLines: Line[];
}

function startNetwork(
	header: Line,
	ordinal: number,
	seenIndices: Set<number>,
	diagnostics: VgDiagnostic[],
): NetworkAcc {
	const toks = header.toks;
	let i = 1; // toks[0] is NETWORK
	let index: number | undefined;
	let indexToken: Token | undefined;
	if (toks[i]?.kind === "int_lit") {
		indexToken = toks[i];
		index = Number.parseInt(indexToken!.text.replace(/_/g, ""), 10);
		i++;
	}
	if (index === undefined) index = ordinal;

	let language = "FBD";
	let languageToken: Token | undefined;
	if (toks[i]?.kind === "identifier") {
		languageToken = toks[i];
		language = languageToken!.text;
		i++;
	}

	let label: string | undefined;
	let disabled = false;
	for (; i < toks.length; i++) {
		const t = toks[i]!;
		if (t.kind === "wstring_lit") label = t.text.replace(/^"|"$/g, "");
		else if (isWord(t, "DISABLED")) disabled = true;
	}

	if (index !== undefined && seenIndices.has(index)) {
		diagnostics.push(
			diag(
				"VG_DUPLICATE_NETWORK",
				`network index ${index} appears more than once — indices must be unique (their localIds would collide)`,
				indexToken?.span ?? header.span,
			),
		);
	}
	if (index !== undefined) seenIndices.add(index);

	return {
		index,
		indexToken,
		language,
		languageToken,
		label,
		disabled,
		comments: [],
		headerSpan: header.span,
		stmtLines: [],
	};
}

function buildNetwork(
	acc: NetworkAcc,
	closer: Line | undefined,
	source: string | undefined,
	diagnostics: VgDiagnostic[],
): VgNetwork {
	const ctx = new NetworkParser(acc, source, diagnostics);
	const statements = ctx.parse();
	const endSpan = closer?.span;
	const span = endSpan !== undefined ? joinSpans(acc.headerSpan, endSpan) : networkExtent(acc);
	return {
		index: acc.index,
		indexToken: acc.indexToken,
		language: acc.language,
		languageToken: acc.languageToken,
		label: acc.label,
		disabled: acc.disabled,
		comments: acc.comments,
		statements,
		headerSpan: acc.headerSpan,
		span,
	};
}

function networkExtent(acc: NetworkAcc): Span {
	const last = acc.stmtLines[acc.stmtLines.length - 1];
	return last !== undefined ? joinSpans(acc.headerSpan, last.span) : acc.headerSpan;
}

// ─── Per-network statement parsing (two-pass, mirrors VgParser.cs) ────

class NetworkParser {
	private readonly source?: string;
	private readonly diagnostics: VgDiagnostic[];
	private readonly lines: Line[];
	private readonly letWires = new Set<string>();
	private readonly enWires = new Set<string>();
	private readonly declared = new Set<string>();

	constructor(acc: NetworkAcc, source: string | undefined, diagnostics: VgDiagnostic[]) {
		this.source = source;
		this.diagnostics = diagnostics;
		this.lines = acc.stmtLines;
	}

	parse(): VgStatement[] {
		this.scanLetWires();
		this.scanEnWires();
		const out: VgStatement[] = [];
		for (const line of this.lines) {
			const stmt = this.parseStatement(line.toks, line.span);
			if (stmt !== undefined) out.push(stmt);
		}
		return out;
	}

	/** Pass 0 — every `LET <name> :=` (including inside an EN/ENO `IF … THEN LET …`). */
	private scanLetWires(): void {
		for (const line of this.lines) {
			const toks = line.toks;
			for (let i = 0; i + 2 < toks.length; i++) {
				if (isWord(toks[i], "LET") && toks[i + 1]?.kind === "identifier" && isPunctTok(toks[i + 2], ":=")) {
					this.letWires.add(toks[i + 1]!.text);
				}
			}
		}
	}

	/** Pass 1 — names used as an `IF <name> THEN … := …` guard (EN enable wires). */
	private scanEnWires(): void {
		for (const line of this.lines) {
			const toks = line.toks;
			if (isWord(toks[0], "IF") && toks[1]?.kind === "identifier" && isWord(toks[2], "THEN")) {
				if (toks.some((t) => isPunctTok(t, ":="))) this.enWires.add(toks[1]!.text);
			}
		}
	}

	private declare(name: VgName): void {
		if (this.declared.has(name.text)) {
			this.diagnostics.push(
				diag(
					"VG_DUPLICATE_NAME",
					`'${name.text}' is defined more than once in this network — each wire, result, instance, and label name must be unique`,
					name.span,
				),
			);
			return;
		}
		this.declared.add(name.text);
	}

	private parseStatement(toks: Token[], span: Span): VgStatement | undefined {
		if (toks.length === 0) return undefined;

		// LET prefix → a wire definition (name is already in letWires).
		let letToken: Token | undefined;
		let rest = toks;
		if (isWord(toks[0], "LET")) {
			letToken = toks[0];
			rest = toks.slice(1);
		}

		// Control flow (label / JMP / RETURN / conditional JMP|RETURN).
		const cf = this.tryControlFlow(rest, span);
		if (cf !== undefined) return cf;

		// EN/ENO IF (the guard name must be a known enable wire).
		if (isWord(rest[0], "IF") && rest[1]?.kind === "identifier" && this.enWires.has(rest[1]!.text)) {
			return this.parseEnEnoIf(rest, span);
		}

		const asg = splitAssignment(rest);
		if (asg === undefined) {
			// No top-level `:=` → an FB-instance call, else unknown.
			if (isCallShape(rest)) return this.parseFbCall(rest, span);
			this.diagnostics.push(diag("VG_PARSE", `not a valid VG statement: ${slice(this.source, span)}`, span));
			return { kind: "unknown_stmt", tokens: rest, span };
		}

		const { lhs, rhs } = asg;
		if (lhs.length === 0) {
			this.diagnostics.push(diag("VG_PARSE", "assignment has no target", span));
			return { kind: "unknown_stmt", tokens: rest, span };
		}

		const lhsName = lhs.length === 1 && lhs[0]!.kind === "identifier" ? nameOf(lhs[0]!) : undefined;
		const isLet = letToken !== undefined;
		const isEn = lhsName !== undefined && this.enWires.has(lhsName.text);
		const isWire = isLet || (lhsName !== undefined && this.letWires.has(lhsName.text));

		// EN enable bindings are checked BEFORE wires (mirrors VgParser.cs):
		// `LET en2 := en1` legitimately references another EN wire, so it must
		// not trip the leaf-references-temp check.
		if (isEn && lhsName !== undefined) {
			this.declare(lhsName);
			const producer = this.parseOperand(rhs);
			return { kind: "wire_def", name: lhsName, producer, isEnBinding: true, letToken, span };
		}

		if (isWire && lhsName !== undefined) {
			this.declare(lhsName);
			const producer = this.parseOperand(rhs);
			this.checkLeafTemps(producer);
			return { kind: "wire_def", name: lhsName, producer, isEnBinding: false, letToken, span };
		}

		// Otherwise an outVariable / coil sink.
		const target = this.parseLValue(lhs);
		const value = this.parseOperand(rhs);
		return { kind: "sink", target, value, span };
	}

	private tryControlFlow(toks: Token[], span: Span): VgStatement | undefined {
		// label:  →  name ':'
		if (toks.length === 2 && toks[0]?.kind === "identifier" && isPunctTok(toks[1], ":")) {
			const name = nameOf(toks[0]!);
			this.declare(name);
			return { kind: "label", name, span };
		}

		// IF <cond> THEN (JMP <name> | RETURN) [;] END_IF
		if (isWord(toks[0], "IF")) {
			const thenIdx = toks.findIndex((t) => isWord(t, "THEN"));
			const endIdx = toks.findIndex((t) => isWord(t, "END_IF"));
			if (thenIdx > 0 && endIdx > thenIdx) {
				const after = stripSemis(toks.slice(thenIdx + 1, endIdx));
				if (isWord(after[0], "JMP") && after[1]?.kind === "identifier") {
					const cond = this.parseOperand(toks.slice(1, thenIdx));
					return { kind: "jump", target: nameOf(after[1]!), condition: cond, span };
				}
				if (isWord(after[0], "RETURN") && after.length === 1) {
					const cond = this.parseOperand(toks.slice(1, thenIdx));
					return { kind: "return", condition: cond, span };
				}
			}
		}

		// JMP <name>
		if (isWord(toks[0], "JMP") && toks[1]?.kind === "identifier") {
			return { kind: "jump", target: nameOf(toks[1]!), span };
		}
		// RETURN
		if (toks.length === 1 && isWord(toks[0], "RETURN")) {
			return { kind: "return", span };
		}
		return undefined;
	}

	private parseEnEnoIf(toks: Token[], span: Span): VgStatement {
		const thenIdx = toks.findIndex((t) => isWord(t, "THEN"));
		const endIdx = toks.findIndex((t) => isWord(t, "END_IF"));
		const en = nameOf(toks[1]!);
		if (thenIdx < 0 || endIdx < thenIdx) {
			this.diagnostics.push(diag("VG_BAD_EXPRESSION", "malformed EN/ENO IF — expected 'IF en THEN … END_IF'", span));
			return { kind: "unknown_stmt", tokens: toks, span };
		}
		const innerToks = stripSemis(toks.slice(thenIdx + 1, endIdx));
		const innerSpan = innerToks.length > 0 ? spanOf(innerToks) : span;
		const body = this.parseStatement(innerToks, innerSpan) ?? { kind: "unknown_stmt", tokens: innerToks, span: innerSpan };
		return { kind: "en_eno_if", en, body, span };
	}

	private parseFbCall(toks: Token[], span: Span): VgStatement {
		const call = splitCall(toks);
		if (call === undefined) {
			this.diagnostics.push(diag("VG_PARSE", "expected an FB call 'inst(pin := value, …)'", span));
			return { kind: "unknown_stmt", tokens: toks, span };
		}
		const instance = nameOf(call.callee);
		this.declare(instance);
		const args = this.parseArgs(call.inner);
		return { kind: "fb_call", instance, args, span };
	}

	// ── operand / expression engine ──────────────────────────────────

	private parseOperand(toks: Token[]): VgOperand {
		const { mods, core: coreToks } = extractMods(toks);
		const core = this.parseCore(coreToks);
		return { kind: "operand", mods, core, span: toks.length > 0 ? spanOf(toks) : core.span };
	}

	private parseCore(toks: Token[]): VgCore {
		if (toks.length === 0) {
			return { kind: "leaf", text: "", tokens: [], isLiteral: false, span: emptySpan() };
		}
		if (isSingleGroup(toks)) {
			return this.parseGroup(toks);
		}
		if (isCallShape(toks)) {
			return this.parseFunctionCall(toks);
		}
		// Parens that form neither a single group nor a call → malformed.
		if (toks.some((t) => isPunctTok(t, "(") || isPunctTok(t, ")"))) {
			this.diagnostics.push(
				diag(
					"VG_BAD_EXPRESSION",
					`malformed expression — unbalanced or partially-parenthesised: ${this.text(toks)}`,
					spanOf(toks),
				),
			);
			return { kind: "leaf", text: this.text(toks), tokens: toks, isLiteral: false, span: spanOf(toks) };
		}
		// Member access `inst.Pin` — a single ident, then '.', then ident(s).
		const dotIdx = toks.findIndex((t) => isPunctTok(t, "."));
		if (dotIdx > 0 && toks[0]?.kind === "identifier" && toks[dotIdx + 1]?.kind === "identifier") {
			const base = nameOf(toks[0]!);
			const member: VgName = { text: this.text(toks.slice(dotIdx + 1)), span: spanOf(toks.slice(dotIdx + 1)) };
			return { kind: "member", base, member, span: spanOf(toks) };
		}
		// Anything else → a leaf (single name/literal, or opaque inlined text).
		const single = toks.length === 1 ? toks[0]! : undefined;
		const isLiteral = single !== undefined && LITERAL_KINDS.has(single.kind);
		const name =
			single !== undefined && (single.kind === "identifier" || single.keyword !== undefined) && !isLiteral
				? nameOf(single)
				: undefined;
		return { kind: "leaf", text: this.text(toks), tokens: toks, isLiteral, name, span: spanOf(toks) };
	}

	private parseGroup(toks: Token[]): VgCore {
		// toks is a single balanced group: ( … ).
		const inner = toks.slice(1, toks.length - 1);
		const span = spanOf(toks);
		const words = mergeLeadingNot(splitWords(inner));

		// A well-formed group is `operand OP operand [OP operand …]` —
		// odd word count ≥ 3 (even=operand, odd=operator). Mirrors
		// VgParser.SplitTopLevelOperator's whitespace split.
		if (words.length < 3 || words.length % 2 === 0) {
			this.diagnostics.push(
				diag("VG_BAD_EXPRESSION", `operator expression must be 'a OP b [OP c …]': ${this.text(inner)}`, span),
			);
			return { kind: "group", opTokens: [], operands: [], span };
		}

		const opTokens: Token[] = [];
		let malformedOperator = false;
		for (let i = 1; i < words.length; i += 2) {
			const w = words[i]!;
			if (w.length !== 1) {
				malformedOperator = true;
				this.diagnostics.push(diag("VG_BAD_EXPRESSION", `expected a single operator, found '${this.text(w)}'`, spanOf(w)));
				continue;
			}
			opTokens.push(w[0]!);
		}
		const operands = words.filter((_, i) => i % 2 === 0).map((w) => this.parseOperand(w));
		if (malformedOperator || opTokens.length === 0) {
			return { kind: "group", opTokens, operands, span };
		}

		// One operator KIND per group.
		const opText = opTokens[0]!.text;
		for (const op of opTokens) {
			if (op.text.toUpperCase() !== opText.toUpperCase()) {
				this.diagnostics.push(
					diag("VG_BAD_EXPRESSION", `one operator per parenthesised group; found '${op.text}' and '${opText}'`, op.span),
				);
			}
		}
		const symbol = canonicalOperatorSymbol(opText);
		if (symbol === undefined) {
			this.diagnostics.push(diag("VG_UNKNOWN_OPERATOR", `unknown operator '${opText}'`, opTokens[0]!.span));
		}
		return { kind: "group", op: symbol, opTokens, operands, span };
	}

	private parseFunctionCall(toks: Token[]): VgCore {
		const call = splitCall(toks)!;
		return { kind: "call", callee: nameOf(call.callee), args: this.parseArgs(call.inner), span: spanOf(toks) };
	}

	private parseArgs(inner: Token[]): VgArg[] {
		const parts = splitTopLevelCommas(inner);
		return parts
			.filter((p) => p.length > 0)
			.map((p) => {
				const asg = splitAssignment(p);
				if (asg !== undefined && asg.lhs.length === 1 && asg.lhs[0]!.kind === "identifier") {
					const pin = nameOf(asg.lhs[0]!);
					const value = this.parseOperand(asg.rhs);
					return { pin, value, span: spanOf(p) };
				}
				return { value: this.parseOperand(p), span: spanOf(p) };
			});
	}

	private parseLValue(toks: Token[]): VgLValue {
		const names = toks.filter((t) => t.kind === "identifier").map((t) => nameOf(t));
		return { text: this.text(toks), tokens: toks, names, span: spanOf(toks) };
	}

	/** A leaf may not alias an internal wire (`LET g2 := NOT g1`) — §10 VG_LEAF_REFERENCES_TEMP. */
	private checkLeafTemps(producer: VgOperand): void {
		const core = producer.core;
		if (core.kind !== "leaf") return;
		// A leaf is a real SOURCE (literal / real variable), never an alias of
		// an internal wire. The bridge scans the leaf's identifiers for wire
		// names — a single bare name that IS a wire (`LET g2 := g1`) is just as
		// invalid as an opaque `a + g1`. Literals are always fine.
		if (core.isLiteral) return;
		for (const t of core.tokens) {
			if (t.kind === "identifier" && this.letWires.has(t.text)) {
				this.diagnostics.push(
					diag(
						"VG_LEAF_REFERENCES_TEMP",
						`leaf '${core.text}' derives from the internal wire '${t.text}', so it is not a valid leaf — a NOT/edge rides on the consumer, and an expression over wires is written inline at its consumer`,
						t.span,
					),
				);
			}
		}
	}

	private text(toks: Token[]): string {
		return slice(this.source, toks.length > 0 ? spanOf(toks) : emptySpan()) || toks.map((t) => t.text).join(" ");
	}
}

// ─── Token-level helpers ─────────────────────────────────────────────

/** Group significant tokens (excluding ws/block-comment/pragma/eof) by start line. */
function groupLines(tokens: Token[]): Line[] {
	const lines: Line[] = [];
	let cur: Token[] = [];
	let curLine = -1;
	for (const t of tokens) {
		if (TRIVIA.has(t.kind)) continue;
		if (t.span.startLine !== curLine && cur.length > 0) {
			lines.push({ toks: cur, span: spanOf(cur) });
			cur = [];
		}
		curLine = t.span.startLine;
		cur.push(t);
	}
	if (cur.length > 0) lines.push({ toks: cur, span: spanOf(cur) });
	return lines;
}

function stripTrailingSemicolons(line: Line): Line {
	let toks = line.toks;
	while (toks.length > 0 && isPunctTok(toks[toks.length - 1], ";")) toks = toks.slice(0, -1);
	return { toks, span: toks.length > 0 ? spanOf(toks) : line.span };
}

function stripSemis(toks: Token[]): Token[] {
	return toks.filter((t) => !isPunctTok(t, ";"));
}

/** Find the splitting `:=` (the first top-level one that isn't inside a call). */
function splitAssignment(toks: Token[]): { lhs: Token[]; rhs: Token[] } | undefined {
	const asgIdx = toks.findIndex((t) => isPunctTok(t, ":="));
	if (asgIdx < 0) return undefined;
	const parenIdx = toks.findIndex((t) => isPunctTok(t, "("));
	if (parenIdx >= 0 && parenIdx < asgIdx) return undefined; // `:=` is inside a call → FB call
	return { lhs: toks.slice(0, asgIdx), rhs: toks.slice(asgIdx + 1) };
}

/** A name token — an identifier or a keyword used as a name (many ST
 *  keywords double as function names: MAX, MIN, SEL, ABS, ADD, …). */
function isNameTok(t: Token | undefined): boolean {
	return t !== undefined && (t.kind === "identifier" || t.kind === "keyword");
}

/** A call shape: `name ( … )` with the opening paren matching the final token. */
function isCallShape(toks: Token[]): boolean {
	if (toks.length < 3) return false;
	if (!isNameTok(toks[0])) return false;
	if (!isPunctTok(toks[1], "(")) return false;
	if (!isPunctTok(toks[toks.length - 1], ")")) return false;
	// The paren at [1] must close only at the very end.
	let depth = 0;
	for (let i = 1; i < toks.length; i++) {
		if (isPunctTok(toks[i], "(")) depth++;
		else if (isPunctTok(toks[i], ")")) {
			depth--;
			if (depth === 0 && i < toks.length - 1) return false;
		}
	}
	return depth === 0;
}

function splitCall(toks: Token[]): { callee: Token; inner: Token[] } | undefined {
	if (toks.length < 3 || !isNameTok(toks[0]) || !isPunctTok(toks[1], "(")) return undefined;
	if (!isPunctTok(toks[toks.length - 1], ")")) return undefined;
	return { callee: toks[0]!, inner: toks.slice(2, toks.length - 1) };
}

/** Is the whole token run a single balanced parenthesised group? */
function isSingleGroup(toks: Token[]): boolean {
	if (toks.length < 2 || !isPunctTok(toks[0], "(") || !isPunctTok(toks[toks.length - 1], ")")) return false;
	let depth = 0;
	for (let i = 0; i < toks.length; i++) {
		if (isPunctTok(toks[i], "(")) depth++;
		else if (isPunctTok(toks[i], ")")) {
			depth--;
			if (depth === 0 && i < toks.length - 1) return false;
		}
	}
	return depth === 0;
}

/**
 * Split a group's inner tokens into whitespace-separated "words" at depth
 * 0 (parentheses suppress the split). Whitespace is detected via span gaps
 * since the lexer's whitespace tokens were filtered out. This mirrors
 * VgParser.SplitTopLevelOperator's depth-aware whitespace split, so an
 * operand like `(a OR b)`, `inst.Q`, or `MAX(a, b)` stays one word while
 * `a AND b` splits into three.
 */
function splitWords(inner: Token[]): Token[][] {
	const words: Token[][] = [];
	let cur: Token[] = [];
	let depth = 0;
	for (const t of inner) {
		const prev = cur[cur.length - 1];
		if (depth === 0 && prev !== undefined && prev.span.end < t.span.start) {
			words.push(cur);
			cur = [];
		}
		cur.push(t);
		if (isPunctTok(t, "(")) depth++;
		else if (isPunctTok(t, ")")) depth--;
	}
	if (cur.length > 0) words.push(cur);
	return words;
}

/** Merge a standalone leading `NOT` word onto the operand it negates. */
function mergeLeadingNot(words: Token[][]): Token[][] {
	const out: Token[][] = [];
	for (let i = 0; i < words.length; i++) {
		const w = words[i]!;
		if (w.length === 1 && isWord(w[0], "NOT") && i + 1 < words.length) {
			out.push([...w, ...words[i + 1]!]);
			i++;
		} else {
			out.push(w);
		}
	}
	return out;
}

/** Split argument list tokens by top-level commas. */
function splitTopLevelCommas(inner: Token[]): Token[][] {
	const parts: Token[][] = [];
	let cur: Token[] = [];
	let depth = 0;
	for (const t of inner) {
		if (isPunctTok(t, "(")) depth++;
		else if (isPunctTok(t, ")")) depth--;
		else if (depth === 0 && isPunctTok(t, ",")) {
			parts.push(cur);
			cur = [];
			continue;
		}
		cur.push(t);
	}
	parts.push(cur);
	return parts;
}

/** Strip operand modifiers: leading NOT, trailing RISING/FALLING/SET/RESET. */
function extractMods(toks: Token[]): { mods: VgMods; core: Token[] } {
	let core = toks;
	let negated = false;
	let edge: VgMods["edge"];
	let storage: VgMods["storage"];
	const modTokens: Token[] = [];

	if (isWord(core[0], "NOT")) {
		negated = true;
		modTokens.push(core[0]!);
		core = core.slice(1);
	}
	let stripped = true;
	while (stripped) {
		stripped = false;
		const last = core[core.length - 1];
		if (isWord(last, "RISING")) {
			edge = "rising";
			modTokens.push(last!);
			core = core.slice(0, -1);
			stripped = true;
		} else if (isWord(last, "FALLING")) {
			edge = "falling";
			modTokens.push(last!);
			core = core.slice(0, -1);
			stripped = true;
		} else if (isWord(last, "SET")) {
			storage = "set";
			modTokens.push(last!);
			core = core.slice(0, -1);
			stripped = true;
		} else if (isWord(last, "RESET")) {
			storage = "reset";
			modTokens.push(last!);
			core = core.slice(0, -1);
			stripped = true;
		}
	}
	return { mods: { negated, edge, storage, tokens: modTokens }, core };
}

// ─── Span / misc helpers ─────────────────────────────────────────────

function nameOf(t: Token): VgName {
	return { text: t.text, span: t.span };
}

function spanOf(toks: Token[]): Span {
	const first = toks[0]!;
	const last = toks[toks.length - 1]!;
	return joinSpans(first.span, last.span);
}

function joinSpans(a: Span, b: Span): Span {
	return {
		start: a.start,
		end: b.end,
		startLine: a.startLine,
		startCol: a.startCol,
		endLine: b.endLine,
		endCol: b.endCol,
	};
}

function bodySpan(tokens: Token[]): Span {
	const sig = tokens.filter((t) => !TRIVIA.has(t.kind));
	if (sig.length === 0) return emptySpan();
	return joinSpans(sig[0]!.span, sig[sig.length - 1]!.span);
}

function emptySpan(): Span {
	return { start: 0, end: 0, startLine: 1, startCol: 0, endLine: 1, endCol: 0 };
}

function slice(source: string | undefined, span: Span): string {
	if (source === undefined) return "";
	return source.slice(span.start, span.end);
}

function lineText(line: Line): string {
	return line.toks.map((t) => t.text).join(" ");
}

function diag(code: VgDiagnosticCode, message: string, span: Span): VgDiagnostic {
	return { code, message, span };
}
