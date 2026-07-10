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
import type { Span } from "./span.js"
import type { Keyword } from "./tokens.js"
import { Cursor } from "./cursor.js"
import { skipFolderDirective } from "./util.js"
import { mergeSpans as merge, parseAssignable, parseExpression } from "./expression.js"
import type { BodySpan, CaseArm, CaseLabel, Expr, IfBranch, ParseError, Statement, StatementList } from "./ast.js"

export interface BodyParse {
  statements: StatementList
  ok: boolean
  /** First recorded error (diagnostic-quality, for corpus triage only — never surfaced to the user). */
  firstError?: string
  /** All recorded parse errors (an `expect*` mismatch = a definite syntax error at a precise span). Surfaced
   *  as diagnostics by `checkParseErrors`; the resilient-recovery work (phase 2) grows this past one entry. */
  errors: readonly ParseError[]
}

// A BodySpan is immutable and parsed identically every time, but the ~15 semantic checks each iterate
// `bodies()` → `parseStatements(body)`, so without this a POU body is re-parsed once per check per run.
// Keyed on BodySpan identity: same parse → cache hit; a document re-parse yields fresh BodySpans (old
// entries GC'd), so edits are never stale. Parse-once is what makes the multi-check registry actually cheap.
const parseCache = new WeakMap<BodySpan, BodyParse>()

export function parseStatements(body: BodySpan): BodyParse {
  const cached = parseCache.get(body)
  if (cached !== undefined) return cached
  // BodySpan.tokens is a slice with no EOF sentinel; append one so the
  // cursor's peek()/atEof() terminate correctly at the body's end.
  const toks = body.tokens
  const last = toks[toks.length - 1]
  const eofSpan: Span = last
    ? {
        start: last.span.end,
        end: last.span.end,
        startLine: last.span.endLine,
        startCol: last.span.endCol,
        endLine: last.span.endLine,
        endCol: last.span.endCol,
      }
    : { start: 0, end: 0, startLine: 1, startCol: 0, endLine: 1, endCol: 0 }
  const cur = new Cursor([...toks, { kind: "eof", text: "", span: eofSpan }])
  const statements = parseStatementList(cur, () => false)
  const errors = cur.getErrors()
  const ok = errors.length === 0 && cur.atEof()
  // When the list stopped before EOF with no recorded error, the blocker is the token we stopped on.
  const firstError = ok
    ? undefined
    : (errors[0]?.message ?? `unexpected ${cur.peek().kind} '${cur.peek().text.slice(0, 24)}'`)
  const result: BodyParse = { statements, ok, firstError, errors }
  parseCache.set(body, result)
  return result
}

function atKeyword(cur: Cursor, ...kws: Keyword[]): boolean {
  const t = cur.peek()
  return t.kind === "keyword" && t.keyword !== undefined && kws.includes(t.keyword)
}

function lastSpan(list: ReadonlyArray<{ span: Span }>, fallback: Span): Span {
  return list.length > 0 ? (list[list.length - 1] as { span: Span }).span : fallback
}

// Recovery anchors for a garbage statement: a `;` (end of the bad statement) or a statement-starter /
// block-structural keyword (start of the next real thing). Skipping to one of these lets a single unparsable
// statement (a typo, a stray token) yield one diagnostic while the rest of the body still parses. Safe now
// that the block constructs self-recover (missing-token insertion + closer recovery) — `parseStatement` returns
// a node for a malformed IF/CASE/FOR/…, so anything that still fails to parse is genuinely a bad statement, not
// a half-consumed construct dumping its tail here (which is what made an earlier list-level skip cascade).
const STMT_SYNC: readonly Keyword[] = [
  "IF", "CASE", "FOR", "WHILE", "REPEAT", "RETURN", "EXIT", "CONTINUE", "__TRY",
  "END_IF", "ELSIF", "ELSE", "END_CASE", "END_FOR", "END_WHILE", "END_REPEAT", "UNTIL",
  "__CATCH", "__FINALLY", "__ENDTRY",
]

function parseStatementList(cur: Cursor, stop: (cur: Cursor) => boolean): StatementList {
  const out: Statement[] = []
  while (!cur.atEof() && !stop(cur)) {
    // `%FOLDER <path>` is bridge folder metadata prepended to a child body — skip it like trivia.
    if (skipFolderDirective(cur)) continue
    const before = cur.mark()
    const s = parseStatement(cur)
    if (s !== undefined) {
      out.push(s)
      continue
    }
    // Unparsable statement (error already recorded). Skip to the next statement boundary and keep going. The
    // trailing `consume()` guarantees ≥1 token of progress per iteration, so recovery can never loop forever.
    cur.recoverTo({ puncts: [";"], keywords: STMT_SYNC })
    cur.eatPunct(";")
    if (cur.mark() === before) cur.consume()
  }
  return out
}

function parseStatement(cur: Cursor): Statement | undefined {
  const t = cur.peek()
  if (t.kind === "punct" && t.text === ";") {
    const semi = cur.consume()
    return { kind: "empty", span: semi.span }
  }
  if (t.kind === "keyword") {
    switch (t.keyword) {
      case "IF":
        return parseIf(cur)
      case "CASE":
        return parseCase(cur)
      case "FOR":
        return parseFor(cur)
      case "WHILE":
        return parseWhile(cur)
      case "REPEAT":
        return parseRepeat(cur)
      case "RETURN": {
        const k = cur.consume()
        cur.eatPunct(";")
        return { kind: "return", span: k.span }
      }
      case "EXIT": {
        const k = cur.consume()
        cur.eatPunct(";")
        return { kind: "exit", span: k.span }
      }
      case "CONTINUE": {
        const k = cur.consume()
        cur.eatPunct(";")
        return { kind: "continue", span: k.span }
      }
      case "__TRY":
        return parseTry(cur)
    }
  }
  return parseExprOrAssign(cur)
}

function parseExprOrAssign(cur: Cursor): Statement | undefined {
  const expr = parseExpression(cur)
  if (expr === undefined) return undefined
  // Assignment operators: plain `:=` plus the IEC set/reset/reference forms `S=` / `R=` / `REF=`.
  const opTok = cur.peek()
  const isAssignOp =
    opTok.kind === "punct" &&
    (opTok.text === ":=" || opTok.text === "S=" || opTok.text === "R=" || opTok.text === "REF=")
  if (isAssignOp) {
    cur.consume() // the assignment operator
    const op = opTok.text === ":=" ? undefined : (opTok.text as "S=" | "R=" | "REF=")
    let value = parseExpression(cur)
    if (value === undefined) return undefined
    // Chained assignment `a := b := c` (CODESYS): each `:=` promotes the last RHS to an
    // intermediate target; all receive the final value. Only plain `:=` chains.
    const chained: Expr[] = []
    if (op === undefined) {
      while (cur.eatPunct(":=") !== undefined) {
        chained.push(value)
        value = parseExpression(cur)
        if (value === undefined) return undefined
      }
    }
    const semi = cur.expectPunct(";", "after assignment")
    if (semi === undefined) return undefined
    return {
      kind: "assign",
      target: expr,
      value,
      ...(op !== undefined ? { op } : {}),
      ...(chained.length > 0 ? { chained } : {}),
      span: merge(expr.span, semi.span),
    }
  }
  const semi = cur.expectPunct(";", "after statement")
  if (semi === undefined) return undefined
  if (expr.kind === "call") return { kind: "call_stmt", call: expr, span: merge(expr.span, semi.span) }
  // A bare expression terminated by `;` — a no-op read CODESYS tolerates (e.g. `fb.Status.Flag;`,
  // a placeholder written elsewhere). Keep it in the tree so the whole body still tree-parses.
  return { kind: "expr_stmt", expr, span: merge(expr.span, semi.span) }
}

function parseTry(cur: Cursor): Statement | undefined {
  const kw = cur.consume() // __TRY
  const tryBody = parseStatementList(cur, (c) => atKeyword(c, "__CATCH", "__FINALLY", "__ENDTRY"))
  let catchVar: Expr | undefined
  let catchBody: StatementList | undefined
  if (cur.eatKeyword("__CATCH") !== undefined) {
    if (cur.expectPunct("(", "in __CATCH") === undefined) return undefined
    catchVar = parseExpression(cur)
    if (catchVar === undefined) return undefined
    if (cur.expectPunct(")", "closing __CATCH") === undefined) return undefined
    catchBody = parseStatementList(cur, (c) => atKeyword(c, "__FINALLY", "__ENDTRY"))
  }
  let finallyBody: StatementList | undefined
  if (cur.eatKeyword("__FINALLY") !== undefined) {
    finallyBody = parseStatementList(cur, (c) => atKeyword(c, "__ENDTRY"))
  }
  const end = cur.expectKeyword("__ENDTRY", "closing __TRY") // missing closer: record, keep the parsed bodies
  cur.eatPunct(";")
  return {
    kind: "try",
    tryBody,
    ...(catchVar ? { catchVar } : {}),
    ...(catchBody ? { catchBody } : {}),
    ...(finallyBody ? { finallyBody } : {}),
    span: merge(kw.span, end?.span ?? kw.span),
  }
}

function parseIf(cur: Cursor): Statement | undefined {
  const kw = cur.consume() // IF
  const branches: IfBranch[] = []
  const first = parseIfBranch(cur)
  if (first === undefined) return undefined
  branches.push(first)
  while (cur.eatKeyword("ELSIF") !== undefined) {
    const b = parseIfBranch(cur)
    if (b === undefined) return undefined
    branches.push(b)
  }
  let elseBody: StatementList | undefined
  if (cur.eatKeyword("ELSE") !== undefined) {
    elseBody = parseStatementList(cur, (c) => atKeyword(c, "END_IF"))
  }
  const end = cur.expectKeyword("END_IF", "closing IF") // missing closer: record, but keep the parsed branches
  cur.eatPunct(";")
  return { kind: "if", branches, elseBody, span: merge(kw.span, end?.span ?? kw.span) }
}

function parseIfBranch(cur: Cursor): IfBranch | undefined {
  const cond = parseAssignable(cur) // `IF x := f() THEN` — inline assignment in the condition (CODESYS)
  if (cond === undefined) return undefined
  // Missing-token recovery (Roslyn-style): record the absent THEN but DON'T abandon the branch — parse the
  // body anyway and let the IF consume its END_IF. Bailing here instead dumps the body + END_IF back to the
  // statement list, which mis-parses them into a spurious cascade error. One error in → one error out.
  cur.expectKeyword("THEN", "in IF")
  const body = parseStatementList(cur, (c) => atKeyword(c, "ELSIF", "ELSE", "END_IF"))
  return { kind: "if_branch", cond, body, span: merge(cond.span, lastSpan(body, cond.span)) }
}

function parseCase(cur: Cursor): Statement | undefined {
  const kw = cur.consume() // CASE
  const selector = parseExpression(cur)
  if (selector === undefined) return undefined
  cur.expectKeyword("OF", "in CASE") // missing-token recovery — parse the arms regardless (see parseIfBranch)
  const arms: CaseArm[] = []
  while (!cur.atEof() && !atKeyword(cur, "ELSE", "END_CASE")) {
    if (!isArmStart(cur)) break // not a label header — let END_CASE expectation fail → fallback
    const arm = parseCaseArm(cur)
    if (arm === undefined) return undefined
    arms.push(arm)
  }
  let elseBody: StatementList | undefined
  if (cur.eatKeyword("ELSE") !== undefined) {
    elseBody = parseStatementList(cur, (c) => atKeyword(c, "END_CASE"))
  }
  const end = cur.expectKeyword("END_CASE", "closing CASE") // missing closer: record, but keep the parsed arms
  cur.eatPunct(";")
  return { kind: "case", selector, arms, elseBody, span: merge(kw.span, end?.span ?? kw.span) }
}

function parseCaseArm(cur: Cursor): CaseArm | undefined {
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
      sp = merge(value.span, u.span)
    }
    labels.push({ kind: "case_label", value, upper, span: sp })
    if (cur.eatPunct(",") !== undefined) continue
    break
  }
  const colon = cur.expectPunct(":", "after CASE labels")
  if (colon === undefined) return undefined
  const body = parseStatementList(cur, (c) => atKeyword(c, "ELSE", "END_CASE") || isArmStart(c))
  const head = labels[0]
  return { kind: "case_arm", labels, body, span: merge(head.span, lastSpan(body, colon.span)) }
}

/**
 * Bounded lookahead: does the cursor sit at the start of a CASE arm — a
 * label list (`5`, `StateNone`, `PACK_ML.State.X`, `1..3`, comma-
 * separated) terminated by a plain `:`? Distinguishes an arm from a
 * statement (`x := …` has `:=`, `f(…)` has `(`). Does not consume.
 */
function isArmStart(cur: Cursor): boolean {
  let i = 0
  const atom = (): boolean => {
    let t = cur.peek(i)
    if (t.kind === "punct" && (t.text === "-" || t.text === "+")) {
      i += 1
      t = cur.peek(i)
    }
    const isAtom =
      t.kind === "int_lit" ||
      t.kind === "real_lit" ||
      t.kind === "identifier" ||
      (t.kind === "keyword" && t.keyword !== undefined)
    if (!isAtom) return false
    i += 1
    while (
      cur.peek(i).kind === "punct" &&
      cur.peek(i).text === "." &&
      (cur.peek(i + 1).kind === "identifier" || cur.peek(i + 1).kind === "keyword")
    ) {
      i += 2
    }
    return true
  }
  if (!atom()) return false
  if (cur.peek(i).kind === "punct" && cur.peek(i).text === "..") {
    i += 1
    if (!atom()) return false
  }
  while (cur.peek(i).kind === "punct" && cur.peek(i).text === ",") {
    i += 1
    if (!atom()) return false
    if (cur.peek(i).kind === "punct" && cur.peek(i).text === "..") {
      i += 1
      if (!atom()) return false
    }
  }
  return cur.peek(i).kind === "punct" && cur.peek(i).text === ":"
}

function parseFor(cur: Cursor): Statement | undefined {
  const kw = cur.consume() // FOR
  const controlVar = parseExpression(cur)
  if (controlVar === undefined) return undefined
  if (cur.expectPunct(":=", "in FOR") === undefined) return undefined
  const from = parseExpression(cur)
  if (from === undefined) return undefined
  if (cur.expectKeyword("TO", "in FOR") === undefined) return undefined
  const to = parseExpression(cur)
  if (to === undefined) return undefined
  let by: Expr | undefined
  if (cur.eatKeyword("BY") !== undefined) {
    by = parseExpression(cur)
    if (by === undefined) return undefined
  }
  cur.expectKeyword("DO", "in FOR") // missing-token recovery — parse the body regardless (see parseIfBranch)
  const body = parseStatementList(cur, (c) => atKeyword(c, "END_FOR"))
  const end = cur.expectKeyword("END_FOR", "closing FOR") // missing closer: record, but keep the parsed body
  cur.eatPunct(";")
  return { kind: "for", controlVar, from, to, by, body, span: merge(kw.span, end?.span ?? kw.span) }
}

function parseWhile(cur: Cursor): Statement | undefined {
  const kw = cur.consume() // WHILE
  const cond = parseAssignable(cur)
  if (cond === undefined) return undefined
  cur.expectKeyword("DO", "in WHILE") // missing-token recovery — parse the body regardless (see parseIfBranch)
  const body = parseStatementList(cur, (c) => atKeyword(c, "END_WHILE"))
  const end = cur.expectKeyword("END_WHILE", "closing WHILE") // missing closer: record, but keep the parsed body
  cur.eatPunct(";")
  return { kind: "while", cond, body, span: merge(kw.span, end?.span ?? kw.span) }
}

function parseRepeat(cur: Cursor): Statement | undefined {
  const kw = cur.consume() // REPEAT
  const body = parseStatementList(cur, (c) => atKeyword(c, "UNTIL"))
  if (cur.expectKeyword("UNTIL", "in REPEAT") === undefined) return undefined
  const until = parseAssignable(cur)
  if (until === undefined) return undefined
  const end = cur.expectKeyword("END_REPEAT", "closing REPEAT") // missing closer: record, keep the parsed body
  cur.eatPunct(";")
  return { kind: "repeat", body, until, span: merge(kw.span, end?.span ?? kw.span) }
}
