/**
 * Structural ST pretty-printer (st-format, Phase 3) — emits canonical Structured Text from the
 * `st-body-ast` statement/expression tree, replacing the token re-indenter for parseable bodies.
 *
 * What it canonicalizes: block indentation from tree nesting, one statement per line, one space
 * around `:=` / binary operators, `, ` between list items, no space before `;`, canonical control-flow
 * spelling. Identifiers and literals are emitted VERBATIM (case preserved — they carry their source
 * text). Keywords and word-operators (`IF`, `AND`, `MOD`, …) normalize to canonical UPPERCASE — the AST
 * does not retain their casing, and uppercase is the conventional IEC form. Parentheses are printed
 * exactly where the source had them (the AST keeps `ParenExpr`), so no precedence math is needed and
 * meaning is preserved — the `parse(format(x)) ≡ parse(x)` test is the guard.
 *
 * COMMENTS ARE NOT HANDLED HERE — the AST drops them. The caller reconciles comments from the token
 * stream and falls back to the re-indenter when they can't be placed (see the wire-up in `format.ts`).
 */
import type {
	Assignment, CallArg, CallExpr, CaseStatement, Expr, ForStatement, IfStatement, RepeatStatement,
	Statement, StatementList, TryStatement, WhileStatement,
} from "../../parser/ast.js";

export interface PrintContext {
	/** One indent level (`"\t"` or N spaces). */
	unit: string;
	/** Line separator. */
	eol: string;
}

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
			// Word operator (`NOT`) needs a space; symbol prefixes (`-`, `+`, `&`) bind tight.
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
	// An unconnected output (`out => `) has no value.
	return a.value !== undefined ? `${a.param.name} ${sep} ${printExpr(a.value)}` : `${a.param.name} ${sep} `;
}

/** Print a statement list at `level`, one statement per line. */
export function printStatements(list: StatementList, ctx: PrintContext, level: number): string {
	return list.map((s) => printStatement(s, ctx, level)).join(ctx.eol);
}

function indent(ctx: PrintContext, level: number): string {
	return ctx.unit.repeat(Math.max(0, level));
}

function printStatement(s: Statement, ctx: PrintContext, level: number): string {
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
			return printIf(s, ctx, level);
		case "case":
			return printCase(s, ctx, level);
		case "for":
			return printFor(s, ctx, level);
		case "while":
			return printWhile(s, ctx, level);
		case "repeat":
			return printRepeat(s, ctx, level);
		case "try":
			return printTry(s, ctx, level);
	}
}

function printAssign(s: Assignment): string {
	// Chained `a := b := c` — all l-values then the value, joined by `:=`.
	if (s.chained !== undefined && s.chained.length > 0) {
		return [s.target, ...s.chained, s.value].map(printExpr).join(" := ");
	}
	return `${printExpr(s.target)} ${s.op ?? ":="} ${printExpr(s.value)}`;
}

function block(body: StatementList, ctx: PrintContext, level: number): string {
	// An empty block still occupies the indented region (no line) — callers place the header/footer.
	return body.length === 0 ? "" : printStatements(body, ctx, level + 1) + ctx.eol;
}

function printIf(s: IfStatement, ctx: PrintContext, level: number): string {
	const pad = indent(ctx, level);
	let out = "";
	s.branches.forEach((b, i) => {
		out += `${pad}${i === 0 ? "IF" : "ELSIF"} ${printExpr(b.cond)} THEN${ctx.eol}`;
		out += block(b.body, ctx, level);
	});
	if (s.elseBody !== undefined) {
		out += `${pad}ELSE${ctx.eol}`;
		out += block(s.elseBody, ctx, level);
	}
	out += `${pad}END_IF`;
	return out;
}

function printCase(s: CaseStatement, ctx: PrintContext, level: number): string {
	const pad = indent(ctx, level);
	const armPad = indent(ctx, level + 1);
	let out = `${pad}CASE ${printExpr(s.selector)} OF${ctx.eol}`;
	for (const arm of s.arms) {
		const labels = arm.labels.map((l) => (l.upper !== undefined ? `${printExpr(l.value)}..${printExpr(l.upper)}` : printExpr(l.value))).join(", ");
		out += `${armPad}${labels}:${ctx.eol}`;
		out += block(arm.body, ctx, level + 1);
	}
	if (s.elseBody !== undefined) {
		out += `${armPad}ELSE${ctx.eol}`;
		out += block(s.elseBody, ctx, level + 1);
	}
	out += `${pad}END_CASE`;
	return out;
}

function printFor(s: ForStatement, ctx: PrintContext, level: number): string {
	const pad = indent(ctx, level);
	const by = s.by !== undefined ? ` BY ${printExpr(s.by)}` : "";
	let out = `${pad}FOR ${printExpr(s.controlVar)} := ${printExpr(s.from)} TO ${printExpr(s.to)}${by} DO${ctx.eol}`;
	out += block(s.body, ctx, level);
	out += `${pad}END_FOR`;
	return out;
}

function printWhile(s: WhileStatement, ctx: PrintContext, level: number): string {
	const pad = indent(ctx, level);
	let out = `${pad}WHILE ${printExpr(s.cond)} DO${ctx.eol}`;
	out += block(s.body, ctx, level);
	out += `${pad}END_WHILE`;
	return out;
}

function printRepeat(s: RepeatStatement, ctx: PrintContext, level: number): string {
	const pad = indent(ctx, level);
	let out = `${pad}REPEAT${ctx.eol}`;
	out += block(s.body, ctx, level);
	out += `${pad}UNTIL ${printExpr(s.until)}${ctx.eol}${pad}END_REPEAT`;
	return out;
}

function printTry(s: TryStatement, ctx: PrintContext, level: number): string {
	const pad = indent(ctx, level);
	let out = `${pad}__TRY${ctx.eol}`;
	out += block(s.tryBody, ctx, level);
	if (s.catchBody !== undefined) {
		const arg = s.catchVar !== undefined ? printExpr(s.catchVar) : "";
		out += `${pad}__CATCH(${arg})${ctx.eol}`;
		out += block(s.catchBody, ctx, level);
	}
	if (s.finallyBody !== undefined) {
		out += `${pad}__FINALLY${ctx.eol}`;
		out += block(s.finallyBody, ctx, level);
	}
	out += `${pad}__ENDTRY`;
	return out;
}
