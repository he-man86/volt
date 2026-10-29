/**
 * ST STATEMENTS — the statement parser, driving the expression parser to build a body's `StatementList`.
 *
 * `parseStatementTokens` returns `{ statements, ok, errors, messages }`: `ok` is true only when every token was consumed
 * with zero errors; the errors are the body's syntax errors, which the `parse-errors` check reports. It never throws. A
 * body is parsed through `body-parse.ts` `bodyStatements`, which caches the parse per body.
 *
 * PRAGMAS ARE TRIVIA, EXCEPT WHERE A STATEMENT MAY START (frontend-conformance 2.7.1/2.7.3, measured on both vendors):
 * there, and only there, the conditional directives (`{IF}`/`{ELSIF}`/`{ELSE}`/`{END_IF}`, `{define}`/`{undefine}`) and
 * the message pragmas act (`applyPragmas`). Inside a statement every pragma is trivia — an `{IF}` inside an expression
 * leaves both its branches in (`prag_if_in_expression_statement` = 31), a `{warning}` there is not said. A chain belongs
 * to the statement list it opens in; a branch not taken is parsed IN SILENCE and dropped (`prag_untaken_branch_syntax_error`
 * builds), so the tree is the one CODESYS compiles: ONE statement tree per body. A condition the world cannot answer
 * leaves only its own chain undecided (`BodyParse.refused`); what lies outside it is read as compiled.
 *
 * The SOURCE reading (`parseSourceStatementTokens`) is the other tree a body has: no condition asked, every branch in and
 * parsed in silence — the text as written, for the services that edit and navigate it, never for a check.
 */
import { eofSpan, joinSpans, type Span, zeroSpan } from "../span.js"
import type { Token } from "../lex/tokens.js"
import { Cursor } from "./cursor.js"
import { parseExpression } from "./expression.js"
import { REFUSED_PLACEHOLDER, type Expr, type ParseError, type Statement, type StatementList } from "../ast/nodes/index.js"
import { type Dialect } from "../lex/vocabulary.js"
import { REFUSED_AT_STATEMENT_START, SOFT_NAME_KEYWORDS } from "../lex/word-sets.js"
import { addressShape } from "../literal/address.js"
import { reportStatementCascade, vendorTokenText } from "./errors.js"
import { identFromToken } from "./names.js"
import type { ConditionWorld } from "../pragmas/condition-eval.js"
import { PRAGMAS, type PragmaMessage, type PragmaState } from "./body-pragmas.js"
import {
  atKeyword,
  atStatementSync,
  BLOCK_ENDERS,
  closeBlock,
  endStatement,
  LEFT_OPEN,
  parseStatementList,
  RESYNCED,
  STILL_EXPECTED,
} from "./statement-list.js"
import { parseCase, parseFor, parseIf, parseRepeat, parseWhile } from "./control.js"

export interface BodyParse {
  statements: StatementList
  ok: boolean
  /** First recorded error (diagnostic-quality, for corpus triage only — never surfaced to the user). */
  firstError?: string
  /** All recorded parse errors (an `expect*` mismatch = a definite syntax error at a precise span). Surfaced
   *  as diagnostics by `checkParseErrors`; the resilient-recovery work (phase 2) grows this past one entry. */
  errors: readonly ParseError[]
  /** The message pragmas the build says, in order. */
  messages: readonly PragmaMessage[]
  /** Set when a conditional pragma asks what the parse's `ConditionWorld` does not hold (a device fact, a project compile
   *  define, the project's names), naming the first such question. Only that chain's branches are undecided: each is
   *  parsed in silence and left out of `statements`, while what lies outside every undecided branch — compiled whichever
   *  way the condition goes — keeps its errors and its messages. `ok` is false: the tree is not the whole body, and no
   *  branch is guessed. */
  refused?: string
}

/** A body's statement tokens parsed as a statement list — uncached; `body-parse.ts` is where a body is parsed once. Its
 *  conditional pragmas are applied against `world` (`pragmas/conditional.ts`). */
export function parseStatementTokens(toks: readonly Token[], dialect: Dialect, world: ConditionWorld = {}): BodyParse {
  return parseTokens(toks, dialect, { world, defines: new Map(), uncertain: new Set(), messages: [], applied: new Set(), silent: [], textErrors: [] })
}

/**
 * A body's statement tokens as WRITTEN — every branch of every chain is in the tree, in source order. Not what any vendor
 * compiles: the tree of the services that edit or navigate the source text (rename, references, folding, selection,
 * hover), where a branch not taken today is still text that comes back when its condition flips (another device,
 * project or define). The directives act as structure where a statement may start, as they do for the vendor, but no
 * condition is asked: every branch is UNDECIDED, parsed in silence and kept — a syntax error in a branch (which builds
 * when the branch is not taken, `prag_untaken_branch_syntax_error`) does not void the rest of the body, while one outside
 * every chain, or a chain's orphan/unterminated structure, still does. Its errors and messages are that reading's; no
 * check reads them.
 */
export function parseSourceStatementTokens(toks: readonly Token[], dialect: Dialect): BodyParse {
  return parseTokens(toks, dialect, { world: {}, defines: new Map(), uncertain: new Set(), messages: [], applied: new Set(), silent: [], source: true, textErrors: [] })
}

function parseTokens(toks: readonly Token[], dialect: Dialect, state: PragmaState | undefined): BodyParse {
  // The tokens are a slice with no EOF sentinel; append one so the cursor's peek()/atEof() terminate correctly at the
  // body's end.
  const last = toks[toks.length - 1]
  const end: Span = last ? eofSpan(last.span) : zeroSpan()
  const cur = new Cursor([...toks, { kind: "eof", text: "", span: end }], dialect, true)
  if (state !== undefined) PRAGMAS.set(cur, state)
  const statements = parseStatementList(cur, parseStatement, () => false, false)
  const errors = state === undefined || state.textErrors.length === 0 ? cur.getErrors() : [...cur.getErrors(), ...state.textErrors].sort((a, b) => a.span.start - b.span.start)
  const refused = state?.refused
  const parsed = errors.length === 0 && cur.atEof()
  // When the list stopped before EOF with no recorded error, the blocker is the token we stopped on.
  const firstError = parsed ? refused : (errors[0]?.message ?? `unexpected ${cur.peek().kind} '${cur.peek().text.slice(0, 24)}'`)
  const out: BodyParse = { statements, ok: parsed && refused === undefined, firstError, errors, messages: state?.messages ?? [] }
  if (refused !== undefined) out.refused = refused
  return out
}

function parseStatement(cur: Cursor): Statement | typeof RESYNCED | undefined {
  const t = cur.peek()
  if (t.kind === "punct" && t.text === ";") {
    const semi = cur.consume()
    return { kind: "empty", span: semi.span }
  }
  if (t.kind === "keyword") {
    switch (t.keyword) {
      case "IF":
        return parseIf(cur, parseStatement)
      case "CASE":
        return parseCase(cur, parseStatement)
      case "FOR":
        return parseFor(cur, parseStatement)
      case "WHILE":
        return parseWhile(cur, parseStatement)
      case "REPEAT":
        return parseRepeat(cur, parseStatement)
      case "RETURN": {
        const k = cur.consume()
        endStatement(cur)
        return { kind: "return", span: k.span }
      }
      case "EXIT": {
        const k = cur.consume()
        endStatement(cur)
        return { kind: "exit", span: k.span }
      }
      case "CONTINUE": {
        const k = cur.consume()
        endStatement(cur)
        return { kind: "continue", span: k.span }
      }
      case "__TRY":
        return parseTry(cur)
      case "JMP":
        return parseJmp(cur)
    }
  }
  // A jump label — `name:` at statement start: an identifier followed by ':' (NOT ':=', a distinct token, so
  // assignment never collides; CASE labels are parsed by parseCaseArm, not here).
  // A REFUSED WORD is no label: `dint:` / `st:` is the word refused and the resync — "Unexpected token 'dint' found", the
  // `:` paired, the statement after it read on (`rec_refused_word_body_label_type`, `_il`), in a CASE arm too
  // (`rec_refused_word_case_label`, both vendors 2026-10-02).
  // A soft-name keyword is a label as it is any name: `Get:` builds, its label "not referenced" (`wp_label_get`, CODESYS
  // 2026-10-29).
  if ((t.kind === "identifier" && !cur.refusedWord(t)) || (t.kind === "keyword" && SOFT_NAME_KEYWORDS.has(t.keyword ?? ""))) {
    const after = cur.peek(1)
    if (after.kind === "punct" && after.text === ":") {
      const nameTok = cur.consume()
      const colon = cur.consume() // ':'
      return { kind: "label", name: identFromToken(nameTok), span: joinSpans(nameTok.span, colon.span) }
    }
  }
  if (refusedAtStatementStart(cur)) {
    const word = cur.consume()
    cur.pushError(`Unexpected token ${vendorTokenText(word)} found`, word.span, word.text)
    reportStatementCascade(cur, atStatementSync)
    return RESYNCED
  }
  return parseExprOrAssign(cur)
}

/**
 * A reserved word CODESYS refuses where a statement starts, reported on the word and resynced (`reportStatementCascade`):
 * a keyword of `REFUSED_AT_STATEMENT_START` (every keyword was asked; the set says which answered this), followed by
 *   - an assignment operator — the word used as a variable (`limit := 1;`, `abs := 1;`, `public := 1;` —
 *     `lex_keyword_assigned_*`, `lex_*_as_variable`, `cc_il_name_cal`), or
 *   - a name — the word used as a statement of its own (`CAL t();`, `END_IF n := 2;` — `lex_keyword_before_name_*`,
 *     `lex_cal_keyword`).
 *   - a `(` — the word called as a statement (`LIMIT(0, a, 5);`, `INI(t, TRUE);` — `stmt_limit_call_statement`,
 *     `stmt_ini_call`, both vendors 2026-10-02: in an OPERAND each is the operator it names, `ok := INI(t, TRUE);`) —
 *     asked of EVERY word of the set, `<w>(n);` (`lex_keyword_called_*`, review 2.6), and every one answered it. The call
 *     operators outside the set (`__DELETE`, `__QUERYINTERFACE`, `__QUERYPOINTER`, `__CURRENTTASK`, `__POOL`) answer in
 *     shapes of their own there too.
 * A keyword followed by anything else is unmeasured and keeps the expression parse. The statement keywords themselves
 * never reach here — `parseStatement` dispatched them above. The Instruction List operators and the elementary type names
 * (`ld`, `r`, `dword` …) are identifiers to this lexer and refused as WORDS here, whatever follows but a call's `(`
 * (`isRefusedWord`, rule R6, frontend-conformance 2.8.3).
 *
 * And A TOKEN NO STATEMENT STARTS WITH, whatever follows it (frontend-conformance 2.6, both vendors 2026-10-02): a
 * literal (`5;`, `1 := a;`, `TRUE;`), a punctuation mark but the global-namespace `.` (`(a);`, `(out) := a;`, `-a;`, the
 * `=` after the label `out :`), and NOT (`NOT x;`) — "Unexpected token 'X' found", then the resync, a name resuming a
 * statement of its own (`stmt_assign_literal_target`, `stmt_bare_literal`, `stmt_bare_true`, `stmt_bare_paren_name`,
 * `stmt_assign_paren_target`, `stmt_bare_negation`, `stmt_assign_spaced_operator`, `stmt_bare_not`).
 */
function refusedAtStatementStart(cur: Cursor): boolean {
  const t = cur.peek()
  // …and an address with a size and NO POSITION assigned to: `%MW := 1;` is refused on the address as a reserved word
  // is (`lit_address_no_position_as_target`, CODESYS 2026-10-01). Only the assignment is measured.
  if (t.kind === "address_lit") return addressShape(t.text).kind === "no-position" && assignOpOf(cur.peek(1)) !== null
  if (LITERAL_KINDS.has(t.kind)) return true
  if (t.kind === "punct") return t.text !== "."
  // a REFUSED WORD — an IL operator or an elementary type's name (`isRefusedWord`, rule R6) — whatever follows, but the
  // `(` of a call: `LTIME()` is a function (`rec_refused_name_cascade_type_word_start`, `cc_il_name_*`, both vendors)
  if (cur.refusedWord(t)) return !(cur.peek(1).kind === "punct" && cur.peek(1).text === "(")
  if (t.kind !== "keyword" || t.keyword === undefined) return false
  if (t.keyword === "TRUE" || t.keyword === "FALSE" || t.keyword === "NOT") return true
  // a block's part here is one no open block looks for — a block's own list ends before its own (`BLOCK_ENDERS`)
  if (BLOCK_ENDERS.has(t.keyword)) return true
  if (!REFUSED_AT_STATEMENT_START.has(t.keyword)) return false
  const next = cur.peek(1)
  // …or a `:` — the word written as a LABEL (`Abstract:`, `LIMIT:` — `wp_label_*`, CODESYS 2026-10-29)
  return assignOpOf(next) !== null || next.kind === "identifier" || (next.kind === "punct" && (next.text === "(" || next.text === ":"))
}

/** The literal token kinds — none starts a statement. */
const LITERAL_KINDS: ReadonlySet<string> = new Set([
  "int_lit", "real_lit", "string_lit", "wstring_lit", "time_lit", "date_lit", "tod_lit", "datetime_lit", "typed_lit",
])

function parseJmp(cur: Cursor): Statement | undefined {
  const kw = cur.consume() // JMP
  // A `;` WHERE THE LABEL BELONGS IS TAKEN FOR IT: `JMP;` is an invalid destination `;` (the analysis words it, with the
  // label it then lacks) and a JMP still wanting its `;` — "';' expected instead of 'out'" before the next statement,
  // which is read on (`rec_jmp_without_label`, both vendors 2026-10-02).
  // …and so is a KEYWORD or a REFUSED WORD: `JMP ld;`, `JMP END_IF;` are "Invalid destination ld for JMP" and "No such
  // label 'INVALID: LD'", the statement then ending at its own `;` (`rec_refused_word_jmp_target`,
  // `rec_jmp_keyword_target`, both vendors 2026-10-02).
  const dest = cur.peek()
  if ((dest.kind === "punct" && dest.text === ";") || dest.kind === "keyword" || cur.refusedWord(dest)) {
    cur.consume()
    const semi = endStatement(cur)
    const placeholder: Expr = { kind: "ident_expr", name: REFUSED_PLACEHOLDER, span: dest.span }
    return { kind: "jmp", target: placeholder, refusedDestination: dest.text, span: joinSpans(kw.span, semi?.span ?? dest.span) }
  }
  const target = parseExpression(cur)
  if (target === undefined) return undefined // parseExpression said why, in the vendors' words
  const semi = endStatement(cur) // a missing `;` is the one line, as after RETURN (`stmt_jmp_no_semicolon`, ST15)
  return { kind: "jmp", target, span: joinSpans(kw.span, semi?.span ?? target.span) }
}

/** The assignment operator a token spells: `"S="`/`"R="`/`"REF="`, `undefined` for `:=`, or `null` when it is not one.
 *  In any case, as the lexer reads it: `x s= y`, `rn ref= m` build (`stmt_s_eq_lower_case`, `stmt_ref_eq_lower_case`,
 *  both vendors 2026-10-02). */
function assignOpOf(t: { kind: string; text: string }): "S=" | "R=" | "REF=" | undefined | null {
  if (t.kind !== "punct") return null
  if (t.text === ":=") return undefined
  const op = t.text.toUpperCase()
  return op === "S=" || op === "R=" || op === "REF=" ? op : null
}

function parseExprOrAssign(cur: Cursor): Statement | undefined {
  // `__POSITION` WHERE A STATEMENT STARTS IS JUST AN UNEXPECTED TOKEN. In an expression the compiler eats the token
  // after it and complains about whatever follows (see `parsePrimary`); at the head of a statement it names the
  // operator itself and stops — one message, no cascade (`sysop_position_bare_statement`).
  const head = cur.peek()
  if (head.kind === "keyword" && head.keyword === "__POSITION") {
    cur.pushError(`Unexpected token '${head.text}' found`, head.span, head.text)
    while (cur.peek().kind !== "eof" && !(cur.peek().kind === "punct" && cur.peek().text === ";")) cur.consume()
    cur.eatPunct(";")
    return undefined
  }
  const expr = parseExpression(cur)
  if (expr === undefined) return undefined
  // Assignment operators: plain `:=` plus the IEC set/reset/reference forms `S=` / `R=` / `REF=`.
  const opTok = cur.peek()
  if (assignOpOf(opTok) !== null) {
    cur.consume() // the assignment operator
    const op = assignOpOf(opTok) ?? undefined
    let value = parseExpression(cur)
    if (value === undefined) return undefined
    // A CHAIN promotes each right-hand side to an intermediate target: `a := b := c`, and — measured, not assumed —
    // `a S= b R= c`, which CODESYS compiles (conformance `set_reset_chained`). This loop used to accept `:=` links
    // only, after a plain `:=` only, so a valid set/reset chain was a parse error ("';' expected instead of 'R='").
    // The operators may mix, so each link keeps its own (`chainOps`).
    const chained: Expr[] = []
    const chainOps: ("S=" | "R=" | "REF=" | undefined)[] = []
    for (let link = assignOpOf(cur.peek()); link !== null; link = assignOpOf(cur.peek())) {
      cur.consume()
      chained.push(value)
      chainOps.push(link ?? undefined)
      value = parseExpression(cur)
      if (value === undefined) return undefined
    }
    const semi = endStatement(cur)
    return {
      kind: "assign",
      target: expr,
      value,
      ...(op !== undefined ? { op } : {}),
      ...(chained.length > 0 ? { chained, chainOps } : {}),
      span: joinSpans(expr.span, semi?.span ?? value.span),
    }
  }
  const semi = endStatement(cur)
  if (expr.kind === "call") return { kind: "call_stmt", call: expr, span: joinSpans(expr.span, semi?.span ?? expr.span) }
  // A bare expression terminated by `;` — a no-op read CODESYS tolerates (e.g. `fb.Status.Flag;`,
  // a placeholder written elsewhere). Keep it in the tree so the whole body still tree-parses.
  if (semi === undefined) return { kind: "expr_stmt", expr, unterminated: true, span: expr.span }
  return { kind: "expr_stmt", expr, span: joinSpans(expr.span, semi.span) }
}

function parseTry(cur: Cursor): Statement | undefined {
  const kw = cur.consume() // __TRY
  const tryBody = parseStatementList(cur, parseStatement, (c) => atKeyword(c, "__CATCH", "__FINALLY", "__ENDTRY"))
  let catchVar: Expr | undefined
  let catchBody: StatementList | undefined
  if (!LEFT_OPEN.has(cur) && cur.eatKeyword("__CATCH") !== undefined) {
    // the operand is optional: `__CATCH` alone builds and runs on both vendors (`stmt_try_catch_without_operand`, ST18)
    if (cur.eatPunct("(") !== undefined) {
      catchVar = parseExpression(cur)
      if (catchVar === undefined) return undefined
      if (cur.expectPunct(")") === undefined) return undefined
    }
    catchBody = parseStatementList(cur, parseStatement, (c) => atKeyword(c, "__FINALLY", "__ENDTRY"))
  }
  let finallyBody: StatementList | undefined
  if (!LEFT_OPEN.has(cur) && cur.eatKeyword("__FINALLY") !== undefined) {
    finallyBody = parseStatementList(cur, parseStatement, (c) => atKeyword(c, "__ENDTRY"))
  }
  const end = closeBlock(cur, "__ENDTRY", STILL_EXPECTED.try) // missing closer: record, keep the parsed bodies
  return {
    kind: "try",
    tryBody,
    ...(catchVar ? { catchVar } : {}),
    ...(catchBody ? { catchBody } : {}),
    ...(finallyBody ? { finallyBody } : {}),
    span: joinSpans(kw.span, end?.span ?? kw.span),
  }
}

