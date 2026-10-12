/**
 * THE CONTROL STATEMENTS — IF, CASE, FOR, WHILE, REPEAT: their parts, their conditions, and the recovery of a condition
 * refused or left out. Each block's lists are parsed through the `StatementParser` it is handed (`statement-list.ts`).
 * Split from `statements.ts` (openspec lsp-same-standard design.md §2.2).
 */
import {
  type Statement,
  type IfBranch,
  type StatementList,
  type CaseArm,
  type CaseLabel,
  type Expr,
  REFUSED_PLACEHOLDER,
} from "../ast/nodes/index.js"
import type { Keyword } from "../lex/vocabulary.js"
import { joinSpans } from "../span.js"
import type { Cursor } from "./cursor.js"
import { expectedInsteadOf, vendorTokenText } from "./errors.js"
import { parseAssignable, parseExpression } from "./expression.js"
import {
  LEFT_OPEN,
  parseStatementList,
  atKeyword,
  closeBlock,
  STILL_EXPECTED,
  lastSpan,
  atStatementSync,
  leaveOpen,
  leftOpen,
  type StatementParser,
} from "./statement-list.js"

export function parseIf(cur: Cursor, one: StatementParser): Statement | undefined {
  const kw = cur.consume() // IF
  const branches: IfBranch[] = []
  const first = parseIfBranch(cur, one)
  if (first === undefined) return undefined
  branches.push(first)
  while (!LEFT_OPEN.has(cur) && cur.eatKeyword("ELSIF") !== undefined) {
    const b = parseIfBranch(cur, one)
    if (b === undefined) return undefined
    branches.push(b)
  }
  let elseBody: StatementList | undefined
  if (!LEFT_OPEN.has(cur) && cur.eatKeyword("ELSE") !== undefined) {
    elseBody = parseStatementList(cur, one, (c) => atKeyword(c, "END_IF"))
  }
  // missing closer: record, but keep the parsed branches
  const end = closeBlock(cur, "END_IF", STILL_EXPECTED.if)
  return { kind: "if", branches, elseBody, span: joinSpans(kw.span, end?.span ?? kw.span) }
}

function parseIfBranch(cur: Cursor, one: StatementParser): IfBranch | undefined {
  const cond = missingCondition(cur, "THEN") ?? parseAssignable(cur) ?? refusedCondition(cur, "THEN") // `IF x := f() THEN` — inline assignment (CODESYS)
  if (cond === undefined) return undefined
  // Missing-token recovery (Roslyn-style): record the absent THEN but DON'T abandon the branch — parse the
  // body anyway and let the IF consume its END_IF. Bailing here instead dumps the body + END_IF back to the
  // statement list, which mis-parses them into a spurious cascade error. One error in → one error out.
  // A THEN standing further on, before the next `;`, is where the vendor resumes, in silence: `IF a b THEN` and
  // `IF a & b THEN` are "'THEN' expected instead of 'b'" / "… '&'" and nothing else (`expr_if_condition_stray_name`,
  // `expr_ampersand_in_if`, both vendors).
  // …and the THEN it names is the repair, after the condition (`qf_c0002_then`) — only where nothing stands between the
  // two: a stray token before a later THEN (`IF a b THEN`) is not cured by another THEN
  if (cur.eatKeyword("THEN") === undefined) {
    const next = cur.peek()
    const resumes = keywordAhead(cur, "THEN") !== undefined
    // …and only before a statement: `IF a END_IF` with a THEN is an empty branch, refused (`empty-block`)
    const branchEmpty = next.kind === "eof" || atKeyword(cur, "ELSIF", "ELSE", "END_IF")
    cur.pushParseError({
      message: expectedInsteadOf("'THEN'", next),
      span: next.span,
      ...(resumes || branchEmpty ? {} : { missing: { text: "THEN", at: cur.previous().span.end, layout: "space" as const } }),
    })
    skipToBeforeSemicolon(cur, "THEN")
  }
  const body = parseStatementList(cur, one, (c) => atKeyword(c, "ELSIF", "ELSE", "END_IF"))
  return { kind: "if_branch", cond, body, span: joinSpans(cond.span, lastSpan(body, cond.span)) }
}

export function parseCase(cur: Cursor, one: StatementParser): Statement | undefined {
  const kw = cur.consume() // CASE
  // an inline assignment is a selector as it is a condition: `CASE a := b OF` (`expr_inline_assign_case_selector`, E26)
  const selector = parseAssignable(cur)
  if (selector === undefined) return undefined
  cur.expectKeyword("OF") // missing-token recovery — parse the arms regardless (see parseIfBranch)
  const arms: CaseArm[] = []
  while (!cur.atEof() && !LEFT_OPEN.has(cur) && !atKeyword(cur, "ELSE", "END_CASE")) {
    if (!isArmStart(cur)) {
      // THE FIRST ARM'S LABEL MISSING: "No CASE label found", and what stands there is read as that arm's statements
      // (`rec_refused_word_case_label_first`, both vendors 2026-10-02 — `CASE n OF int: …` refuses `int` as a statement
      // start). After an arm, a token no arm starts with ended that arm's list, so it is no label header — the END_CASE
      // expectation words it (`closeBlock`).
      if (arms.length > 0) break
      const at = cur.peek()
      cur.pushParseError({ message: "No CASE label found", span: at.span, noCaseLabel: true })
      const body = parseStatementList(cur, one, (c) => atKeyword(c, "ELSE", "END_CASE") || isArmStart(c))
      arms.push({ kind: "case_arm", labels: [], body, span: joinSpans(at.span, lastSpan(body, at.span)) })
      continue
    }
    const arm = parseCaseArm(cur, one)
    if (arm === undefined) return undefined
    arms.push(arm)
  }
  let elseBody: StatementList | undefined
  if (!LEFT_OPEN.has(cur) && cur.eatKeyword("ELSE") !== undefined) {
    elseBody = parseStatementList(cur, one, (c) => atKeyword(c, "END_CASE"))
  }
  // missing closer: record, but keep the parsed arms
  const end = closeBlock(cur, "END_CASE", STILL_EXPECTED.case)
  return { kind: "case", selector, arms, elseBody, span: joinSpans(kw.span, end?.span ?? kw.span) }
}

function parseCaseArm(cur: Cursor, one: StatementParser): CaseArm | undefined {
  const labels: CaseLabel[] = []
  for (;;) {
    const value = parseExpression(cur)
    if (value === undefined) return undefined
    let upper: Expr | undefined
    let sp = value.span
    if (cur.eatPunct("..") !== undefined) {
      const u = parseExpression(cur)
      if (u === undefined) return undefined
      upper = u
      sp = joinSpans(value.span, u.span)
    }
    labels.push({ kind: "case_label", value, upper, span: sp })
    if (cur.eatPunct(",") === undefined) break
    // a trailing comma: the label the colon stands in for is wanted, and the arm is read (`stmt_case_label_trailing_comma`)
    if (atColon(cur)) {
      cur.pushError(`Expression expected instead of ${vendorTokenText(cur.peek())}`, cur.peek().span)
      break
    }
  }
  const colon = cur.expectPunct(":")
  if (colon === undefined) return undefined
  const body = parseStatementList(cur, one, (c) => atKeyword(c, "ELSE", "END_CASE") || isArmStart(c))
  const head = labels[0]
  return { kind: "case_arm", labels, body, span: joinSpans(head.span, lastSpan(body, colon.span)) }
}

/**
 * Does the cursor sit at the start of a CASE arm — a label list (`5`, `StateNone`, `PACK_ML.State.X`, `1..3`, `INT#5`,
 * comma-separated) ended by a plain `:`? Read with the EXPRESSION GRAMMAR the arm itself is parsed with
 * (`parseCaseArm`), on a fork of the cursor, so the two can never disagree about what a label is; a label that does not
 * parse cleanly, or is no label's shape (`isLabelShape`), is no arm start. Distinguishes an arm from a statement (`x := …` has `:=`, `f(…);` its `;`). Does not
 * consume.
 */
function isArmStart(cur: Cursor): boolean {
  const ahead = cur.fork()
  const bound = (): boolean => {
    const e = parseExpression(ahead)
    return e !== undefined && isLabelShape(e)
  }
  const label = (): boolean => bound() && (ahead.eatPunct("..") === undefined || bound())
  if (!label()) return false
  // …a list ended by a trailing comma is an arm too, refused at its colon (`stmt_case_label_trailing_comma`, both vendors
  // 2026-10-02: "Expression expected instead of ':'" and nothing else)
  while (ahead.eatPunct(",") !== undefined) if (!atColon(ahead) && !label()) return false
  return ahead.getErrors().length === 0 && atColon(ahead)
}

const atColon = (cur: Cursor): boolean => cur.peek().kind === "punct" && cur.peek().text === ":"

/**
 * WHAT A CASE LABEL CAN BE: a literal (typed too, `INT#5`, `E#V`), a signed one (`-1`), a name or a qualified name
 * (`PACK_ML.State.X`). An EXPRESSION is no label — `2 + 1:`, `(2):`, `a + 1:` are no arm start, and `a + 1:` is
 * "';' expected instead of ':'" and the resync, the statement before the colon standing (`stmt_case_nonconst_label`,
 * `stmt_case_const_expr_label`, `stmt_case_paren_label`, both vendors 2026-10-02).
 */
function isLabelShape(e: Expr): boolean {
  if (e.kind === "literal" || e.kind === "ident_expr") return true
  if (e.kind === "unary") return (e.op === "-" || e.op === "+") && e.operand.kind === "literal"
  if (e.kind === "member") return e.member.kind === "ident_expr" && (e.base.kind === "ident_expr" || (e.base.kind === "member" && isLabelShape(e.base)))
  return false
}

/**
 * A CONDITION REFUSED INSIDE ITSELF stays the condition's: `IF (a b) THEN` and `WHILE (a b) DO` are "')' expected
 * instead of 'b'" and nothing else — the IF and the WHILE resume at their THEN / DO in silence, as an IF does after a
 * stray name (`expr_paren_stray_name_in_if`, `_in_while`, `expr_if_condition_stray_name`, both vendors 2026-10-02). Only a
 * refused operand that is no keyword (`Cursor.refuseOperand`: the token a parenthesis wanted its `)` before) is taken
 * here, and only when `kw` stands before the next `;`; anything else is left to the statement list, as before. The
 * condition the parse returns is the refused one's placeholder, a name no scope declares.
 */
function refusedCondition(cur: Cursor, kw: Keyword): Expr | undefined {
  const at = cur.peek()
  if (at.kind === "keyword" || cur.refusedWord(at) || !cur.takeRefusedOperand()) return undefined
  const ahead = keywordAhead(cur, kw)
  if (ahead === undefined) {
    cur.refuseOperand()
    return undefined
  }
  for (let k = 0; k < ahead; k++) cur.consume()
  return { kind: "ident_expr", name: REFUSED_PLACEHOLDER, span: at.span }
}

/**
 * A CONDITION LEFT OUT, its keyword where it belongs: `IF THEN` is "Expression expected instead of 'THEN'" and nothing
 * else — the IF reads its THEN and its branch (`rec_expected_expression_condition`, both vendors 2026-10-02). Measured on
 * IF; ELSIF is the same branch. The condition is the refused one's placeholder, a name no scope declares.
 */
function missingCondition(cur: Cursor, kw: Keyword): Expr | undefined {
  if (!atKeyword(cur, kw)) return undefined
  const at = cur.peek()
  cur.pushError(`Expression expected instead of ${vendorTokenText(at)}`, at.span)
  return { kind: "ident_expr", name: REFUSED_PLACEHOLDER, span: at.span }
}

/** How many tokens ahead `kw` stands, when it stands before the next `;` or block keyword; else undefined. */
function keywordAhead(cur: Cursor, kw: Keyword): number | undefined {
  for (let i = 0; ; i++) {
    const t = cur.peek(i)
    if (t.kind === "keyword" && t.keyword === kw) return i
    if (t.kind === "eof" || (t.kind === "punct" && t.text === ";") || atStatementSync(t)) return undefined
  }
}

/** Skip in silence to `kw` and past it, when it stands before the next `;` or block keyword; else leave the cursor. */
function skipToBeforeSemicolon(cur: Cursor, kw: Keyword): void {
  const ahead = keywordAhead(cur, kw)
  if (ahead !== undefined) for (let k = 0; k <= ahead; k++) cur.consume()
}

export function parseFor(cur: Cursor, one: StatementParser): Statement | undefined {
  const kw = cur.consume() // FOR
  const controlVar = parseExpression(cur)
  if (controlVar === undefined) return undefined
  if (cur.expectPunct(":=") === undefined) return undefined
  // an inline assignment is a start value as it is a bound: `FOR i := m := 1 TO 3 DO` (`expr_inline_assign_for_start`, E26)
  const from = parseAssignable(cur)
  if (from === undefined) return undefined
  cur.expectKeyword("TO") // missing-token recovery — the upper bound follows regardless (see parseIfBranch)
  // …and a bound: `FOR i := 1 TO m := 3 DO` (`expr_inline_assign_for_bound`, both vendors build it, E26)
  const to = parseAssignable(cur)
  if (to === undefined) return undefined
  let by: Expr | undefined
  if (cur.eatKeyword("BY") !== undefined) {
    by = parseAssignable(cur)
    if (by === undefined) return undefined
  }
  cur.expectKeyword("DO") // missing-token recovery — parse the body regardless (see parseIfBranch)
  const body = parseStatementList(cur, one, (c) => atKeyword(c, "END_FOR"))
  const end = closeBlock(cur, "END_FOR", STILL_EXPECTED.for) // missing closer: record, but keep the parsed body
  return { kind: "for", controlVar, from, to, by, body, span: joinSpans(kw.span, end?.span ?? kw.span) }
}

export function parseWhile(cur: Cursor, one: StatementParser): Statement | undefined {
  const kw = cur.consume() // WHILE
  const cond = parseAssignable(cur) ?? refusedCondition(cur, "DO")
  if (cond === undefined) return undefined
  cur.expectKeyword("DO") // missing-token recovery — parse the body regardless (see parseIfBranch)
  const body = parseStatementList(cur, one, (c) => atKeyword(c, "END_WHILE"))
  const end = closeBlock(cur, "END_WHILE", STILL_EXPECTED.while) // missing closer: record, but keep the parsed body
  return { kind: "while", cond, body, span: joinSpans(kw.span, end?.span ?? kw.span) }
}

export function parseRepeat(cur: Cursor, one: StatementParser): Statement | undefined {
  const kw = cur.consume() // REPEAT
  const body = parseStatementList(cur, one, (c) => atKeyword(c, "UNTIL"))
  // a list that ended short of its UNTIL leaves the REPEAT open; the condition it never reached is the placeholder
  if (LEFT_OPEN.has(cur) || !atKeyword(cur, "UNTIL")) {
    if (!leftOpen(cur)) {
      cur.expectKeyword("UNTIL")
      return undefined
    }
    leaveOpen(cur, STILL_EXPECTED.repeat)
    return { kind: "repeat", body, until: { kind: "ident_expr", name: REFUSED_PLACEHOLDER, span: cur.peek().span }, span: kw.span }
  }
  cur.consume() // UNTIL
  const until = parseAssignable(cur)
  if (until === undefined) return undefined
  // missing closer: record, keep the parsed body — and where the text ends there, the closer is the repair, on a line of
  // its own after the condition (`qf_c0002_end_block`)
  const end = cur.eatKeyword("END_REPEAT")
  if (end === undefined) {
    const next = cur.peek()
    cur.pushParseError({
      message: expectedInsteadOf("'END_REPEAT'", next),
      span: next.span,
      ...(next.kind === "eof" ? { missing: { text: "END_REPEAT", at: cur.previous().span.end, layout: "line" as const } } : {}),
    })
  }
  cur.eatPunct(";")
  return { kind: "repeat", body, until, span: joinSpans(kw.span, end?.span ?? kw.span) }
}
