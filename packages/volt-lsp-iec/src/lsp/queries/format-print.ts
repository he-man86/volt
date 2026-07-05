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

interface Trivia {
	/** A comment, or a blank-line marker (a source gap of ≥1 empty line → preserved as ONE blank line). */
	kind: "comment" | "blank";
	text: string;
	start: number;
	startLine: number;
	/** True when a comment is the first non-trivia token on its source line (→ prints on its own line). */
	ownLine: boolean;
}

/** Extract comments AND blank-line markers in source order — the trivia the AST drops but a formatter keeps. */
function extractTrivia(tokens: readonly Token[]): Trivia[] {
	const codeLines = new Set<number>(); // lines with a code token seen BEFORE the current scan point
	const out: Trivia[] = [];
	for (const t of tokens) {
		if (t.kind === "line_comment" || t.kind === "block_comment") {
			out.push({ kind: "comment", text: t.text, start: t.span.start, startLine: t.span.startLine, ownLine: !codeLines.has(t.span.startLine) });
		} else if (t.kind === "whitespace" && (t.text.match(/\n/g)?.length ?? 0) >= 2) {
			// ≥2 newlines in one whitespace run = at least one blank line. Collapse to a single blank marker.
			out.push({ kind: "blank", text: "", start: t.span.start, startLine: t.span.startLine, ownLine: true });
		} else if (!isTrivia(t.kind) && t.kind !== "eof") {
			codeLines.add(t.span.startLine);
		}
	}
	return out;
}

/** Consumes trivia in source order as the printer walks statements. Comment preservation is guaranteed by the
 *  final flush — every comment is emitted at latest when the top-level list flushes to `Infinity`. */
class Weaver {
	private i = 0;
	/** Suppresses a blank line at the very start of a block and collapses consecutive blanks. */
	private atBlockStart = true;
	constructor(
		private readonly ts: Trivia[],
		private readonly ctx: PrintContext,
	) {}

	/** Emit every not-yet-consumed trivium starting before `before`: comments on their own line at `level`,
	 *  blank markers as a single empty line (never leading a block, never doubled). `noBlank` drops blanks —
	 *  used at a block-boundary flush so a blank line never sits right before `ELSE` / `END_*` / the next arm. */
	leading(before: number, level: number, noBlank = false): string {
		let out = "";
		while (this.i < this.ts.length && this.ts[this.i]!.start < before) {
			const t = this.ts[this.i]!;
			if (t.kind === "blank") {
				if (!this.atBlockStart && !noBlank) out += this.ctx.eol; // one blank line
			} else {
				out += this.ctx.unit.repeat(Math.max(0, level)) + t.text + this.ctx.eol;
				this.atBlockStart = false;
			}
			this.i++;
		}
		return out;
	}

	/** Consume a comment trailing code on `endLine`, returned as ` <text>` for the statement's line. */
	trailing(endLine: number): string {
		const t = this.ts[this.i];
		if (t !== undefined && t.kind === "comment" && !t.ownLine && t.startLine === endLine) {
			this.i++;
			return " " + t.text;
		}
		return "";
	}

	/** Called when a statement line is emitted, so the next blank marker is allowed. */
	markContent(): void {
		this.atBlockStart = false;
	}
}

/** Print a full body with its comments woven in. `tokens` is the lexed body; `statements` its parsed tree. */
export function printBody(statements: StatementList, tokens: readonly Token[], ctx: PrintContext, level = 0): string {
	const w = new Weaver(extractTrivia(tokens), ctx);
	const out = printStatements(statements, ctx, level, w, Infinity);
	// Flush any comments after the last statement (trailing block/file comments), then drop trailing blank
	// lines — body content carries none (spacing around the body is the splice context's concern), and a
	// trailing blank would break idempotency (a lone `\n` isn't a blank marker on re-parse).
	const tail = w.leading(Infinity, level);
	const full = tail === "" ? out : out === "" ? tail : out + ctx.eol + tail;
	return full.replace(/(?:\r?\n)+$/, "");
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
		w?.markContent();
		const trail = w !== undefined ? w.trailing(s.span.endLine) : "";
		parts.push(lead + text + trail);
	}
	// Flush own-line comments sitting before this block's closing keyword — but NOT blank lines (a blank
	// right before `ELSE`/`END_*`/the next arm is dropped, which also keeps re-printing idempotent).
	if (w !== undefined && Number.isFinite(rangeEnd)) {
		const tail = w.leading(rangeEnd, level, true);
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

/** Print a nested body at `level+1`, weaving its comments up to `rangeEnd` (the block's closing keyword).
 *  Adds a trailing newline whenever the body produced ANY line (statements OR flushed comments), so the
 *  closing/continuation keyword the caller emits next always lands on its own line. */
function block(body: StatementList, ctx: PrintContext, level: number, w: Weaver | undefined, rangeEnd: number): string {
	const inner = printStatements(body, ctx, level + 1, w, rangeEnd);
	return inner === "" ? "" : inner + ctx.eol;
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
