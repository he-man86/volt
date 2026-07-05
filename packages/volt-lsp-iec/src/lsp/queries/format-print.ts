/**
 * Structural ST pretty-printer (st-format, Phase 3) — emits canonical Structured Text from the
 * `st-body-ast` statement/expression tree, replacing the token re-indenter for parseable bodies.
 *
 * What it canonicalizes: block indentation from tree nesting, one statement per line, one space
 * around `:=` / binary operators, `, ` between list items, no space before `;`, canonical control-flow
 * spelling. Identifiers and literals are emitted VERBATIM (case preserved). Keywords and word-operators
 * (`IF`, `AND`, `MOD`, …) normalize to canonical UPPERCASE — the AST does not retain their casing.
 * Parentheses are printed exactly where the source had them (the AST keeps `ParenExpr`), so no
 * precedence math is needed and meaning is preserved — the `parse(format(x)) ≡ parse(x)` test is the guard.
 *
 * COMMENTS: the AST drops them, so they are woven back from the token stream by source position (a cursor
 * advancing in lockstep with the statements). Own-line comments print on their own line at the surrounding
 * indent; a comment trailing a statement prints after its `;`; anything else is flushed at the end of its
 * block. This NEVER drops a comment (the final flush catches the remainder) — an interior comment simply
 * relocates to a trailing position, which is semantically identical since `parse` ignores comments.
 */
import type {
	Assignment, CallArg, CaseStatement, Expr, ForStatement, IfStatement, RepeatStatement,
	Statement, StatementList, TryStatement, WhileStatement,
} from "../../parser/ast.js";
import { isTrivia, type Token } from "../../lexer/tokens.js";

export interface PrintContext {
	/** One indent level (`"\t"` or N spaces). */
	unit: string;
	/** Line separator. */
	eol: string;
}

// ─── Comment weaving ─────────────────────────────────────────────────────

interface Comment {
	text: string;
	start: number;
	startLine: number;
	/** True when the comment is the first non-trivia token on its source line (→ prints on its own line). */
	ownLine: boolean;
}

/** Extract comment tokens with an own-line vs trailing classification. */
function extractComments(tokens: readonly Token[]): Comment[] {
	const codeLines = new Set<number>(); // lines that have seen a code token BEFORE the current scan point
	const out: Comment[] = [];
	for (const t of tokens) {
		if (t.kind === "line_comment" || t.kind === "block_comment") {
			out.push({ text: t.text, start: t.span.start, startLine: t.span.startLine, ownLine: !codeLines.has(t.span.startLine) });
		} else if (!isTrivia(t.kind) && t.kind !== "eof") {
			codeLines.add(t.span.startLine);
		}
	}
	return out;
}

/** Consumes comments in source order as the printer walks statements. Preservation is guaranteed by the
 *  final flush — every comment is emitted at latest when the top-level list flushes to `Infinity`. */
class Weaver {
	private i = 0;
	constructor(
		private readonly cs: Comment[],
		private readonly ctx: PrintContext,
	) {}

	/** Emit every not-yet-consumed comment starting before `before`, each on its own line at `level`. */
	leading(before: number, level: number): string {
		let out = "";
		while (this.i < this.cs.length && this.cs[this.i]!.start < before) {
			out += this.ctx.unit.repeat(Math.max(0, level)) + this.cs[this.i]!.text + this.ctx.eol;
			this.i++;
		}
		return out;
	}

	/** Consume a comment trailing code on `endLine`, returned as ` <text>` for the statement's line. */
	trailing(endLine: number): string {
		const c = this.cs[this.i];
		if (c !== undefined && !c.ownLine && c.startLine === endLine) {
			this.i++;
			return " " + c.text;
		}
		return "";
	}
}

/** Print a full body with its comments woven in. `tokens` is the lexed body; `statements` its parsed tree. */
export function printBody(statements: StatementList, tokens: readonly Token[], ctx: PrintContext, level = 0): string {
	const w = new Weaver(extractComments(tokens), ctx);
	let out = printStatements(statements, ctx, level, w, Infinity);
	// Flush any comments after the last statement (trailing block/file comments).
	const tail = w.leading(Infinity, level);
	if (tail !== "") out = out === "" ? tail.replace(/\n$/, "") : out + ctx.eol + tail.replace(/\n$/, "");
	return out;
}

// ─── Expressions ─────────────────────────────────────────────────────────

/** Print an expression to canonical single-line text. */
export function printExpr(e: Expr): string {
	switch (e.kind) {
		case "ident_expr":
			return e.name;
		case "literal":
			return e.text; // verbatim — preserves the author's radix/quotes/casing
		case "binary":
			return `${printExpr(e.left)} ${e.op} ${printExpr(e.right)}`;
		case "unary":
			return /^[A-Z_]/i.test(e.op) ? `${e.op} ${printExpr(e.operand)}` : `${e.op}${printExpr(e.operand)}`;
		case "member":
			return `${printExpr(e.base)}.${e.member.name}`;
		case "index":
			return `${printExpr(e.base)}[${e.indices.map(printExpr).join(", ")}]`;
		case "deref":
			return `${printExpr(e.base)}^`;
		case "call":
			return `${printExpr(e.callee)}(${e.args.map(printArg).join(", ")})`;
		case "paren":
			return `(${printExpr(e.inner)})`;
		case "assign_expr":
			return `${printExpr(e.target)} := ${printExpr(e.value)}`;
	}
}

function printArg(a: CallArg): string {
	if (a.param === undefined) return a.value !== undefined ? printExpr(a.value) : "";
	const sep = a.output ? "=>" : ":=";
	return a.value !== undefined ? `${a.param.name} ${sep} ${printExpr(a.value)}` : `${a.param.name} ${sep} `;
}

// ─── Statements ──────────────────────────────────────────────────────────

/** Print a statement list at `level`. `w`/`rangeEnd` weave comments (undefined `w` = no comments). */
export function printStatements(list: StatementList, ctx: PrintContext, level: number, w?: Weaver, rangeEnd = Infinity): string {
	const parts: string[] = [];
	for (const s of list) {
		const lead = w !== undefined ? w.leading(s.span.start, level) : "";
		const text = printStatement(s, ctx, level, w);
		const trail = w !== undefined ? w.trailing(s.span.endLine) : "";
		parts.push(lead + text + trail);
	}
	// Flush own-line comments sitting before this block's closing keyword.
	if (w !== undefined && Number.isFinite(rangeEnd)) {
		const tail = w.leading(rangeEnd, level);
		if (tail !== "") parts.push(tail.replace(/\n$/, ""));
	}
	return parts.join(ctx.eol);
}

function indent(ctx: PrintContext, level: number): string {
	return ctx.unit.repeat(Math.max(0, level));
}

function printStatement(s: Statement, ctx: PrintContext, level: number, w?: Weaver): string {
	const pad = indent(ctx, level);
	switch (s.kind) {
		case "assign":
			return pad + printAssign(s) + ";";
		case "call_stmt":
			return pad + printExpr(s.call) + ";";
		case "expr_stmt":
			return pad + printExpr(s.expr) + ";";
		case "return":
			return pad + "RETURN;";
		case "exit":
			return pad + "EXIT;";
		case "continue":
			return pad + "CONTINUE;";
		case "empty":
			return pad + ";";
		case "if":
			return printIf(s, ctx, level, w);
		case "case":
			return printCase(s, ctx, level, w);
		case "for":
			return printFor(s, ctx, level, w);
		case "while":
			return printWhile(s, ctx, level, w);
		case "repeat":
			return printRepeat(s, ctx, level, w);
		case "try":
			return printTry(s, ctx, level, w);
	}
}

function printAssign(s: Assignment): string {
	if (s.chained !== undefined && s.chained.length > 0) {
		return [s.target, ...s.chained, s.value].map(printExpr).join(" := ");
	}
	return `${printExpr(s.target)} ${s.op ?? ":="} ${printExpr(s.value)}`;
}

/** Print a nested body at `level+1`, weaving its comments up to `rangeEnd` (the block's closing keyword). */
function block(body: StatementList, ctx: PrintContext, level: number, w: Weaver | undefined, rangeEnd: number): string {
	return body.length === 0 && (w === undefined) ? "" : printStatements(body, ctx, level + 1, w, rangeEnd) + (body.length > 0 ? ctx.eol : "");
}

function printIf(s: IfStatement, ctx: PrintContext, level: number, w?: Weaver): string {
	const pad = indent(ctx, level);
	let out = "";
	s.branches.forEach((b, i) => {
		out += `${pad}${i === 0 ? "IF" : "ELSIF"} ${printExpr(b.cond)} THEN${ctx.eol}`;
		const next = s.branches[i + 1]?.span.start ?? s.elseBody?.[0]?.span.start ?? s.span.end;
		out += block(b.body, ctx, level, w, next);
	});
	if (s.elseBody !== undefined) {
		out += `${pad}ELSE${ctx.eol}`;
		out += block(s.elseBody, ctx, level, w, s.span.end);
	}
	return out + `${pad}END_IF`;
}

function printCase(s: CaseStatement, ctx: PrintContext, level: number, w?: Weaver): string {
	const pad = indent(ctx, level);
	const armPad = indent(ctx, level + 1);
	let out = `${pad}CASE ${printExpr(s.selector)} OF${ctx.eol}`;
	s.arms.forEach((arm, i) => {
		const labels = arm.labels.map((l) => (l.upper !== undefined ? `${printExpr(l.value)}..${printExpr(l.upper)}` : printExpr(l.value))).join(", ");
		out += `${armPad}${labels}:${ctx.eol}`;
		const next = s.arms[i + 1]?.span.start ?? s.elseBody?.[0]?.span.start ?? s.span.end;
		out += block(arm.body, ctx, level + 1, w, next);
	});
	if (s.elseBody !== undefined) {
		out += `${armPad}ELSE${ctx.eol}`;
		out += block(s.elseBody, ctx, level + 1, w, s.span.end);
	}
	return out + `${pad}END_CASE`;
}

function printFor(s: ForStatement, ctx: PrintContext, level: number, w?: Weaver): string {
	const pad = indent(ctx, level);
	const by = s.by !== undefined ? ` BY ${printExpr(s.by)}` : "";
	const head = `${pad}FOR ${printExpr(s.controlVar)} := ${printExpr(s.from)} TO ${printExpr(s.to)}${by} DO${ctx.eol}`;
	return head + block(s.body, ctx, level, w, s.span.end) + `${pad}END_FOR`;
}

function printWhile(s: WhileStatement, ctx: PrintContext, level: number, w?: Weaver): string {
	const pad = indent(ctx, level);
	return `${pad}WHILE ${printExpr(s.cond)} DO${ctx.eol}` + block(s.body, ctx, level, w, s.span.end) + `${pad}END_WHILE`;
}

function printRepeat(s: RepeatStatement, ctx: PrintContext, level: number, w?: Weaver): string {
	const pad = indent(ctx, level);
	return `${pad}REPEAT${ctx.eol}` + block(s.body, ctx, level, w, s.until.span.start) + `${pad}UNTIL ${printExpr(s.until)}${ctx.eol}${pad}END_REPEAT`;
}

function printTry(s: TryStatement, ctx: PrintContext, level: number, w?: Weaver): string {
	const pad = indent(ctx, level);
	let out = `${pad}__TRY${ctx.eol}`;
	out += block(s.tryBody, ctx, level, w, s.catchVar?.span.start ?? s.catchBody?.[0]?.span.start ?? s.finallyBody?.[0]?.span.start ?? s.span.end);
	if (s.catchBody !== undefined) {
		out += `${pad}__CATCH(${s.catchVar !== undefined ? printExpr(s.catchVar) : ""})${ctx.eol}`;
		out += block(s.catchBody, ctx, level, w, s.finallyBody?.[0]?.span.start ?? s.span.end);
	}
	if (s.finallyBody !== undefined) {
		out += `${pad}__FINALLY${ctx.eol}`;
		out += block(s.finallyBody, ctx, level, w, s.span.end);
	}
	return out + `${pad}__ENDTRY`;
}
