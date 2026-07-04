/**
 * ST statement parser — drives the expression parser to build the
 * `StatementList` for a POU body.
 *
 * Contract: `parseStatements(body)` returns `{ statements, ok }`. `ok`
 * is true only when the whole body was consumed with zero errors; on
 * any unexpected/unmodeled token it stops and returns `ok: false`,
 * WITHOUT throwing and WITHOUT emitting a diagnostic. Consumers use the
 * token-scan fallback when `ok` is false (see `st-body-ast` design D3).
 *
 * Conditional-compile pragmas (`{IF}` / `{ELSIF}` / `{ELSE}` /
 * `{END_IF}`) are lexer trivia, so the cursor skips them automatically
 * — they are consumed-and-ignored exactly as the prior token scan did
 * (task 3.2), never modeled as nodes this phase.
 */
import type { Span } from "../lexer/span.js";
import type { Keyword } from "../lexer/tokens.js";
import { Cursor } from "./cursor.js";
import { skipFolderDirective } from "./util.js";
import { mergeSpans as merge, parseExpression } from "./expression.js";
import type {
	BodySpan,
	CaseArm,
	CaseLabel,
	Expr,
	IfBranch,
	Statement,
	StatementList,
} from "./ast.js";

export interface BodyParse {
	statements: StatementList;
	ok: boolean;
	/** First recorded error (diagnostic-quality, for corpus triage only — never surfaced to the user). */
	firstError?: string;
}

export function parseStatements(body: BodySpan): BodyParse {
	// BodySpan.tokens is a slice with no EOF sentinel; append one so the
	// cursor's peek()/atEof() terminate correctly at the body's end.
	const toks = body.tokens;
	const last = toks[toks.length - 1];
	const eofSpan: Span = last
		? { start: last.span.end, end: last.span.end, startLine: last.span.endLine, startCol: last.span.endCol, endLine: last.span.endLine, endCol: last.span.endCol }
		: { start: 0, end: 0, startLine: 1, startCol: 0, endLine: 1, endCol: 0 };
	const cur = new Cursor([...toks, { kind: "eof", text: "", span: eofSpan }]);
	const statements = parseStatementList(cur, () => false);
	const errors = cur.getErrors();
	const ok = errors.length === 0 && cur.atEof();
	// When the list stopped before EOF with no recorded error, the blocker is the token we stopped on.
	const firstError = ok
		? undefined
		: (errors[0]?.message ?? `unexpected ${cur.peek().kind} '${cur.peek().text.slice(0, 24)}'`);
	return { statements, ok, firstError };
}

function atKeyword(cur: Cursor, ...kws: Keyword[]): boolean {
	const t = cur.peek();
	return t.kind === "keyword" && t.keyword !== undefined && kws.includes(t.keyword);
}

function lastSpan(list: ReadonlyArray<{ span: Span }>, fallback: Span): Span {
	return list.length > 0 ? (list[list.length - 1] as { span: Span }).span : fallback;
}

function parseStatementList(cur: Cursor, stop: (cur: Cursor) => boolean): StatementList {
	const out: Statement[] = [];
	while (!cur.atEof() && !stop(cur)) {
		// `%FOLDER <path>` is bridge folder metadata prepended to a child body — skip it like trivia.
		if (skipFolderDirective(cur)) continue;
		const s = parseStatement(cur);
		if (s === undefined) break; // error recorded; stop so ok=false surfaces
		out.push(s);
	}
	return out;
}

function parseStatement(cur: Cursor): Statement | undefined {
	const t = cur.peek();
	if (t.kind === "punct" && t.text === ";") {
		const semi = cur.consume();
		return { kind: "empty", span: semi.span };
	}
	if (t.kind === "keyword") {
		switch (t.keyword) {
			case "IF":
				return parseIf(cur);
			case "CASE":
				return parseCase(cur);
			case "FOR":
				return parseFor(cur);
			case "WHILE":
				return parseWhile(cur);
			case "REPEAT":
				return parseRepeat(cur);
			case "RETURN": {
				const k = cur.consume();
				cur.eatPunct(";");
				return { kind: "return", span: k.span };
			}
			case "EXIT": {
				const k = cur.consume();
				cur.eatPunct(";");
				return { kind: "exit", span: k.span };
			}
			case "CONTINUE": {
				const k = cur.consume();
				cur.eatPunct(";");
				return { kind: "continue", span: k.span };
			}
			case "__TRY":
				return parseTry(cur);
		}
	}
	return parseExprOrAssign(cur);
}

function parseExprOrAssign(cur: Cursor): Statement | undefined {
	const expr = parseExpression(cur);
	if (expr === undefined) return undefined;
	// Assignment operators: plain `:=` plus the IEC set/reset/reference forms `S=` / `R=` / `REF=`.
	const opTok = cur.peek();
	const isAssignOp = opTok.kind === "punct" && (opTok.text === ":=" || opTok.text === "S=" || opTok.text === "R=" || opTok.text === "REF=");
	if (isAssignOp) {
		cur.consume(); // the assignment operator
		const op = opTok.text === ":=" ? undefined : (opTok.text as "S=" | "R=" | "REF=");
		let value = parseExpression(cur);
		if (value === undefined) return undefined;
		// Chained assignment `a := b := c` (CODESYS): each `:=` promotes the last RHS to an
		// intermediate target; all receive the final value. Only plain `:=` chains.
		const chained: Expr[] = [];
		while (op === undefined && cur.eatPunct(":=") !== undefined) {
			chained.push(value);
			value = parseExpression(cur);
			if (value === undefined) return undefined;
		}
		const semi = cur.expectPunct(";", "after assignment");
		if (semi === undefined) return undefined;
		return {
			kind: "assign",
			target: expr,
			value,
			...(op !== undefined ? { op } : {}),
			...(chained.length > 0 ? { chained } : {}),
			span: merge(expr.span, semi.span),
		};
	}
	const semi = cur.expectPunct(";", "after statement");
	if (semi === undefined) return undefined;
	if (expr.kind === "call") return { kind: "call_stmt", call: expr, span: merge(expr.span, semi.span) };
	// A bare non-call, non-assignment expression is not a valid ST statement
	// (e.g. an `S=` set-assignment) — fall back rather than invent a node.
	cur.pushError("expected an assignment or call statement", expr.span);
	return undefined;
}

function parseTry(cur: Cursor): Statement | undefined {
	const kw = cur.consume(); // __TRY
	const tryBody = parseStatementList(cur, (c) => atKeyword(c, "__CATCH", "__FINALLY", "__ENDTRY"));
	let catchVar: Expr | undefined;
	let catchBody: StatementList | undefined;
	if (cur.eatKeyword("__CATCH") !== undefined) {
		if (cur.expectPunct("(", "in __CATCH") === undefined) return undefined;
		catchVar = parseExpression(cur);
		if (catchVar === undefined) return undefined;
		if (cur.expectPunct(")", "closing __CATCH") === undefined) return undefined;
		catchBody = parseStatementList(cur, (c) => atKeyword(c, "__FINALLY", "__ENDTRY"));
	}
	let finallyBody: StatementList | undefined;
	if (cur.eatKeyword("__FINALLY") !== undefined) {
		finallyBody = parseStatementList(cur, (c) => atKeyword(c, "__ENDTRY"));
	}
	const end = cur.expectKeyword("__ENDTRY", "closing __TRY");
	if (end === undefined) return undefined;
	cur.eatPunct(";");
	return {
		kind: "try",
		tryBody,
		...(catchVar ? { catchVar } : {}),
		...(catchBody ? { catchBody } : {}),
		...(finallyBody ? { finallyBody } : {}),
		span: merge(kw.span, end.span),
	};
}

function parseIf(cur: Cursor): Statement | undefined {
	const kw = cur.consume(); // IF
	const branches: IfBranch[] = [];
	const first = parseIfBranch(cur);
	if (first === undefined) return undefined;
	branches.push(first);
	while (cur.eatKeyword("ELSIF") !== undefined) {
		const b = parseIfBranch(cur);
		if (b === undefined) return undefined;
		branches.push(b);
	}
	let elseBody: StatementList | undefined;
	if (cur.eatKeyword("ELSE") !== undefined) {
		elseBody = parseStatementList(cur, (c) => atKeyword(c, "END_IF"));
	}
	const end = cur.expectKeyword("END_IF", "closing IF");
	if (end === undefined) return undefined;
	cur.eatPunct(";");
	return { kind: "if", branches, elseBody, span: merge(kw.span, end.span) };
}

function parseIfBranch(cur: Cursor): IfBranch | undefined {
	const cond = parseExpression(cur);
	if (cond === undefined) return undefined;
	if (cur.expectKeyword("THEN", "in IF") === undefined) return undefined;
	const body = parseStatementList(cur, (c) => atKeyword(c, "ELSIF", "ELSE", "END_IF"));
	return { kind: "if_branch", cond, body, span: merge(cond.span, lastSpan(body, cond.span)) };
}

function parseCase(cur: Cursor): Statement | undefined {
	const kw = cur.consume(); // CASE
	const selector = parseExpression(cur);
	if (selector === undefined) return undefined;
	if (cur.expectKeyword("OF", "in CASE") === undefined) return undefined;
	const arms: CaseArm[] = [];
	while (!cur.atEof() && !atKeyword(cur, "ELSE", "END_CASE")) {
		if (!isArmStart(cur)) break; // not a label header — let END_CASE expectation fail → fallback
		const arm = parseCaseArm(cur);
		if (arm === undefined) return undefined;
		arms.push(arm);
	}
	let elseBody: StatementList | undefined;
	if (cur.eatKeyword("ELSE") !== undefined) {
		elseBody = parseStatementList(cur, (c) => atKeyword(c, "END_CASE"));
	}
	const end = cur.expectKeyword("END_CASE", "closing CASE");
	if (end === undefined) return undefined;
	cur.eatPunct(";");
	return { kind: "case", selector, arms, elseBody, span: merge(kw.span, end.span) };
}

function parseCaseArm(cur: Cursor): CaseArm | undefined {
	const labels: CaseLabel[] = [];
	for (;;) {
		const value = parseExpression(cur);
		if (value === undefined) return undefined;
		let upper: Expr | undefined;
		let sp = value.span;
		if (cur.eatPunct("..") !== undefined) {
			const u = parseExpression(cur);
			if (u === undefined) return undefined;
			upper = u;
			sp = merge(value.span, u.span);
		}
		labels.push({ kind: "case_label", value, upper, span: sp });
		if (cur.eatPunct(",") !== undefined) continue;
		break;
	}
	const colon = cur.expectPunct(":", "after CASE labels");
	if (colon === undefined) return undefined;
	const body = parseStatementList(cur, (c) => atKeyword(c, "ELSE", "END_CASE") || isArmStart(c));
	const head = labels[0] as CaseLabel;
	return { kind: "case_arm", labels, body, span: merge(head.span, lastSpan(body, colon.span)) };
}

/**
 * Bounded lookahead: does the cursor sit at the start of a CASE arm — a
 * label list (`5`, `StateNone`, `PACK_ML.State.X`, `1..3`, comma-
 * separated) terminated by a plain `:`? Distinguishes an arm from a
 * statement (`x := …` has `:=`, `f(…)` has `(`). Does not consume.
 */
function isArmStart(cur: Cursor): boolean {
	let i = 0;
	const atom = (): boolean => {
		let t = cur.peek(i);
		if (t.kind === "punct" && (t.text === "-" || t.text === "+")) {
			i += 1;
			t = cur.peek(i);
		}
		const isAtom =
			t.kind === "int_lit" ||
			t.kind === "real_lit" ||
			t.kind === "identifier" ||
			(t.kind === "keyword" && t.keyword !== undefined);
		if (!isAtom) return false;
		i += 1;
		while (
			cur.peek(i).kind === "punct" &&
			cur.peek(i).text === "." &&
			(cur.peek(i + 1).kind === "identifier" || cur.peek(i + 1).kind === "keyword")
		) {
			i += 2;
		}
		return true;
	};
	if (!atom()) return false;
	if (cur.peek(i).kind === "punct" && cur.peek(i).text === "..") {
		i += 1;
		if (!atom()) return false;
	}
	while (cur.peek(i).kind === "punct" && cur.peek(i).text === ",") {
		i += 1;
		if (!atom()) return false;
		if (cur.peek(i).kind === "punct" && cur.peek(i).text === "..") {
			i += 1;
			if (!atom()) return false;
		}
	}
	return cur.peek(i).kind === "punct" && cur.peek(i).text === ":";
}

function parseFor(cur: Cursor): Statement | undefined {
	const kw = cur.consume(); // FOR
	const controlVar = parseExpression(cur);
	if (controlVar === undefined) return undefined;
	if (cur.expectPunct(":=", "in FOR") === undefined) return undefined;
	const from = parseExpression(cur);
	if (from === undefined) return undefined;
	if (cur.expectKeyword("TO", "in FOR") === undefined) return undefined;
	const to = parseExpression(cur);
	if (to === undefined) return undefined;
	let by: Expr | undefined;
	if (cur.eatKeyword("BY") !== undefined) {
		by = parseExpression(cur);
		if (by === undefined) return undefined;
	}
	if (cur.expectKeyword("DO", "in FOR") === undefined) return undefined;
	const body = parseStatementList(cur, (c) => atKeyword(c, "END_FOR"));
	const end = cur.expectKeyword("END_FOR", "closing FOR");
	if (end === undefined) return undefined;
	cur.eatPunct(";");
	return { kind: "for", controlVar, from, to, by, body, span: merge(kw.span, end.span) };
}

function parseWhile(cur: Cursor): Statement | undefined {
	const kw = cur.consume(); // WHILE
	const cond = parseExpression(cur);
	if (cond === undefined) return undefined;
	if (cur.expectKeyword("DO", "in WHILE") === undefined) return undefined;
	const body = parseStatementList(cur, (c) => atKeyword(c, "END_WHILE"));
	const end = cur.expectKeyword("END_WHILE", "closing WHILE");
	if (end === undefined) return undefined;
	cur.eatPunct(";");
	return { kind: "while", cond, body, span: merge(kw.span, end.span) };
}

function parseRepeat(cur: Cursor): Statement | undefined {
	const kw = cur.consume(); // REPEAT
	const body = parseStatementList(cur, (c) => atKeyword(c, "UNTIL"));
	if (cur.expectKeyword("UNTIL", "in REPEAT") === undefined) return undefined;
	const until = parseExpression(cur);
	if (until === undefined) return undefined;
	const end = cur.expectKeyword("END_REPEAT", "closing REPEAT");
	if (end === undefined) return undefined;
	cur.eatPunct(";");
	return { kind: "repeat", body, until, span: merge(kw.span, end.span) };
}
