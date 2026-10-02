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
import { parseAssignable, parseExpression } from "./expression.js"
import { REFUSED_PLACEHOLDER, type CaseArm, type CaseLabel, type Expr, type IfBranch, type ParseError, type Statement, type StatementList } from "../ast/nodes.js"
import { REFUSED_AT_STATEMENT_START, type Keyword } from "../lex/vocabulary.js"
import { addressShape } from "../literal/address.js"
import { reportStatementCascade, vendorTokenText } from "./errors.js"
import { identFromToken } from "./names.js"
import { directiveOf, evaluateCondition, type ConditionError, type ConditionParse, type ConditionWorld, type MessageSeverity } from "../pragmas/conditional.js"

/** A message pragma (`{warning 'x'}` …) where a statement may start, in a branch taken — what the build says. */
export interface PragmaMessage {
  severity: MessageSeverity
  text: string
  span: Span
}

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

/** The vendor's words for a chain left open where its statement list ends (`cc_unterminated_if`, both vendors). */
const UNTERMINATED_CONDITIONAL = "Unexpected End-of-file found: 'ELSIF', 'ELSE' or 'END_IF' expected"

/** Whether a region of the body is compiled: surely, surely not, or as a condition Volt could not decide goes. */
type Compiled = "on" | "maybe" | "off"

/** A region is compiled as its least-compiled enclosing part is. */
const compiledOf = (parts: readonly Compiled[]): Compiled => (parts.includes("off") ? "off" : parts.includes("maybe") ? "maybe" : "on")

/** The conditional state of one parse: the world its conditions ask, the body's own defines, what it says. */
interface PragmaState {
  world: ConditionWorld
  defines: Map<string, string | undefined>
  /** Defines a `{define}`/`{undefine}` in an undecided branch may have changed: a question about one is undecided too. */
  uncertain: Set<string>
  messages: PragmaMessage[]
  /** Pragma tokens already applied — a trivia run is acted on once. */
  applied: Set<Token>
  /** The branches being parsed in silence, outermost first — not compiled, or undecided. */
  silent: Compiled[]
  /** The first question the world could not answer. */
  refused?: string
  /** The SOURCE reading: no condition is asked, every branch is undecided — parsed in silence and KEPT in the tree. */
  source?: true
  /** The errors of a condition's TEXT, said wherever its directive stands — in a branch not taken, or parsed in silence
   *  inside a statement of one — and so kept apart from the cursor's, which silence drops (`prag_hasattribute_unquoted_*`). */
  textErrors: ParseError[]
}

/** One open `{IF}` chain of a statement list. */
interface Chain {
  /** Whether the branch being read is compiled. */
  compiled: Compiled
  /** Whether a branch of the chain was taken (in a region not compiled, it counts as taken). */
  taken: "yes" | "no" | "maybe"
  sawElse: boolean
}

const PRAGMAS = new WeakMap<Cursor, PragmaState>()

/** A body's statement tokens parsed as a statement list — uncached; `body-parse.ts` is where a body is parsed once. Its
 *  conditional pragmas are applied against `world` (`pragmas/conditional.ts`). */
export function parseStatementTokens(toks: readonly Token[], world: ConditionWorld = {}): BodyParse {
  return parseTokens(toks, { world, defines: new Map(), uncertain: new Set(), messages: [], applied: new Set(), silent: [], textErrors: [] })
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
export function parseSourceStatementTokens(toks: readonly Token[]): BodyParse {
  return parseTokens(toks, { world: {}, defines: new Map(), uncertain: new Set(), messages: [], applied: new Set(), silent: [], source: true, textErrors: [] })
}

function parseTokens(toks: readonly Token[], state: PragmaState | undefined): BodyParse {
  // The tokens are a slice with no EOF sentinel; append one so the cursor's peek()/atEof() terminate correctly at the
  // body's end.
  const last = toks[toks.length - 1]
  const end: Span = last ? eofSpan(last.span) : zeroSpan()
  const cur = new Cursor([...toks, { kind: "eof", text: "", span: end }])
  if (state !== undefined) PRAGMAS.set(cur, state)
  const statements = parseStatementList(cur, () => false)
  const errors = state === undefined || state.textErrors.length === 0 ? cur.getErrors() : [...cur.getErrors(), ...state.textErrors].sort((a, b) => a.span.start - b.span.start)
  const refused = state?.refused
  const parsed = errors.length === 0 && cur.atEof()
  // When the list stopped before EOF with no recorded error, the blocker is the token we stopped on.
  const firstError = parsed ? refused : (errors[0]?.message ?? `unexpected ${cur.peek().kind} '${cur.peek().text.slice(0, 24)}'`)
  const out: BodyParse = { statements, ok: parsed && refused === undefined, firstError, errors, messages: state?.messages ?? [] }
  if (refused !== undefined) out.refused = refused
  return out
}

/**
 * Act on the pragmas in the trivia before the next statement of a list whose open chains are `chains`: the conditional
 * directives and the message pragmas. Errors are the vendor's: an `{ELSE}`/`{ELSIF}` after the chain's `{ELSE}`, or one
 * with no chain open in this list, is "Unexpected pragma: 'X' found without matching 'if'" (`prag_else_twice`,
 * `prag_elsif_after_else`, `prag_unbalanced_end_if`); a condition the vendor does not read is its two errors.
 *
 * A condition the world cannot answer leaves its chain UNDECIDED (`maybe`): each branch is parsed in silence, a define
 * there makes its name uncertain, nothing in it is said — and the chain's structure, which no decision changes, is still
 * tracked, so what follows it is read as the vendor reads it either way.
 */
function applyPragmas(cur: Cursor, st: PragmaState, chains: Chain[]): void {
  for (const p of cur.pragmasAhead()) {
    if (st.applied.has(p)) continue
    st.applied.add(p)
    const d = directiveOf(p.text)
    if (d === undefined) continue
    // an unquoted `hasattribute` attribute is an error of the condition's TEXT: both vendors say it on an {IF}/{ELSIF}
    // whether or not its condition is asked — after a taken branch, in an untaken branch (`prag_hasattribute_unquoted_*`)
    if ((d.kind === "if" || d.kind === "elsif") && !st.source && "errors" in d.condition)
      for (const e of d.condition.errors) if (e.attributeValueString !== undefined) st.textErrors.push({ message: e.message, span: p.span, attributeValueString: e.attributeValueString })
    const top = chains.at(-1)
    // is the region around the innermost open chain compiled — and the region here, inside it?
    const outer = compiledOf([...st.silent, ...chains.slice(0, -1).map((c) => c.compiled)])
    const here = compiledOf([outer, top?.compiled ?? "on"])
    const orphan = (word: string): void => {
      if (outer === "on") cur.pushParseError({ message: `Unexpected pragma: '${word}' found without matching 'if'`, span: p.span, orphanPragma: word })
    }
    const decide = (condition: ConditionParse): boolean | "maybe" => {
      if (st.source) return "maybe"
      if ("refused" in condition) return undecided(st, condition.refused)
      if ("errors" in condition) return vendorErrors(cur, condition.errors, p.span)
      const v = evaluateCondition(condition.ok, st.world, st.defines, st.uncertain)
      if (typeof v === "boolean") return v
      if ("refused" in v) return undecided(st, v.refused)
      return vendorErrors(cur, v.errors, p.span)
    }
    const branch = (v: boolean | "maybe"): Pick<Chain, "compiled" | "taken"> =>
      v === "maybe" ? { compiled: "maybe", taken: "maybe" } : v ? { compiled: "on", taken: "yes" } : { compiled: "off", taken: "no" }
    switch (d.kind) {
      case "if":
        // in a region not surely compiled, a nested chain is as compiled as its region, whatever its condition
        chains.push(here === "on" ? { ...branch(decide(d.condition)), sawElse: false } : { compiled: here, taken: "yes", sawElse: false })
        break
      case "elsif":
        if (top === undefined || top.sawElse) orphan("ELSIF")
        else if (outer !== "on") top.compiled = outer
        else if (top.taken === "yes") top.compiled = "off"
        // an earlier branch may have been taken: this one is undecided, and its condition is not asked
        else if (top.taken === "maybe") top.compiled = "maybe"
        else Object.assign(top, branch(decide(d.condition)))
        break
      case "else":
        if (top === undefined || top.sawElse) orphan("ELSE")
        else {
          top.compiled = outer !== "on" ? outer : top.taken === "yes" ? "off" : top.taken === "no" ? "on" : "maybe"
          top.taken = "yes"
          top.sawElse = true
        }
        break
      case "end_if":
        if (top === undefined) orphan("END_IF")
        else chains.pop()
        break
      case "define":
      case "undefine":
        if (here === "maybe") st.uncertain.add(d.name)
        if (here !== "on") break
        st.uncertain.delete(d.name)
        if (d.kind === "define") st.defines.set(d.name, d.value)
        else st.defines.delete(d.name)
        break
      case "message":
        if (here === "on") st.messages.push({ severity: d.severity, text: d.text, span: p.span })
        break
    }
  }
}

/** A condition the world cannot answer: the first is the body's `refused`, and its chain is undecided. */
function undecided(st: PragmaState, reason: string): "maybe" {
  st.refused ??= reason
  return "maybe"
}

/** Record a condition's vendor errors at its pragma (an error of its text is `PragmaState.textErrors`', said already);
 *  the branch is not taken. */
function vendorErrors(cur: Cursor, errors: readonly ConditionError[], span: Span): false {
  for (const e of errors) if (e.attributeValueString === undefined) cur.pushParseError({ message: e.message, span, ...(e.unexpectedToken === undefined ? {} : { unexpectedToken: e.unexpectedToken }) })
  return false
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

/** Where a refused statement's cascade stops in silence: a recovery anchor of `STMT_SYNC`. */
const atStatementSync = (t: Token): boolean => t.kind === "keyword" && t.keyword !== undefined && STMT_SYNC.includes(t.keyword)

/** A statement the parser refused and already resynced past (`reportStatementCascade`) — nothing to add, nothing to skip. */
const RESYNCED = Symbol("resynced")

/**
 * Where the statement list being parsed ends — its `stop` — for the resync after a missing `;`: a statement whose `;` is
 * missing before the NEXT CASE ARM's label is "';' expected instead of '2'" and nothing else, and the arm is read
 * (`stmt_case_arm_missing_semicolon`, both vendors 2026-10-02). Kept per cursor, the innermost list's.
 */
const LIST_STOP = new WeakMap<Cursor, (cur: Cursor) => boolean>()

function parseStatementList(cur: Cursor, stop: (cur: Cursor) => boolean): StatementList {
  const outer = LIST_STOP.get(cur)
  LIST_STOP.set(cur, stop)
  try {
    return parseStatementsUntil(cur, stop)
  } finally {
    if (outer === undefined) LIST_STOP.delete(cur)
    else LIST_STOP.set(cur, outer)
  }
}

function parseStatementsUntil(cur: Cursor, stop: (cur: Cursor) => boolean): StatementList {
  const out: Statement[] = []
  const st = PRAGMAS.get(cur)
  const chains: Chain[] = []
  for (;;) {
    if (st !== undefined) applyPragmas(cur, st, chains)
    if (cur.atEof() || stop(cur)) break
    const compiled = compiledOf(chains.map((c) => c.compiled))
    if (st !== undefined && compiled !== "on") {
      // a branch not taken, or undecided: parsed in silence, and dropped — kept in the source reading
      st.silent.push(compiled)
      try {
        cur.silently(() => parseListStatement(cur, st.source ? out : []))
      } finally {
        st.silent.pop()
      }
      continue
    }
    parseListStatement(cur, out)
  }
  if (chains.length > 0) cur.pushParseError({ message: UNTERMINATED_CONDITIONAL, span: cur.peek().span, unterminatedConditional: true })
  return out
}

/** Parse the next statement of a list into `out`, recovering past one that does not parse. */
function parseListStatement(cur: Cursor, out: Statement[]): void {
  const before = cur.mark()
  const resumed = cur.takeResumed()
  const s = parseStatement(cur)
  if (s === RESYNCED) return
  if (s !== undefined) {
    out.push(resumed && s.kind === "expr_stmt" ? { ...s, resumed: true } : s)
    return
  }
  // An operand was REFUSED where it stands (`Cursor.refuseOperand`): the vendor resyncs from that token as from a
  // refused statement. A keyword (`NOT_AN_OPERAND`, `lex_keyword_operand_*`) is the pair and `reportStatementCascade`
  // after it; anything else — the token a parenthesis wanted its `)` before, a prefix `&` — is the resync after a
  // missing `;` (`expr_paren_stray_name`, `expr_prefix_ampersand`).
  if (cur.takeRefusedOperand()) {
    if (cur.peek().kind === "keyword") {
      const word = cur.consume()
      cur.pushError(`';' expected instead of ${vendorTokenText(word)}`, word.span)
      cur.pushError(`Unexpected token ${vendorTokenText(word)} found`, word.span, word.text)
      reportStatementCascade(cur, atStatementSync)
    } else resyncAfterMissingSemicolon(cur)
    if (cur.mark() === before) cur.consume()
    return
  }
  // Unparsable statement (error already recorded). Skip to the next statement boundary and keep going. The
  // trailing `consume()` guarantees ≥1 token of progress per iteration, so recovery can never loop forever.
  cur.recoverTo({ puncts: [";"], keywords: STMT_SYNC })
  cur.eatPunct(";")
  if (cur.mark() === before) cur.consume()
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
  if (t.kind === "identifier") {
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
 * never reach here — `parseStatement` dispatched them above. The Instruction List operator NAMES (`ld`, `r` …) are
 * identifiers to this lexer and stay `analysis/checks/names/refused-name.ts`'s.
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
  if (t.kind !== "keyword" || t.keyword === undefined) return false
  if (t.keyword === "TRUE" || t.keyword === "FALSE" || t.keyword === "NOT") return true
  if (!REFUSED_AT_STATEMENT_START.has(t.keyword)) return false
  const next = cur.peek(1)
  return assignOpOf(next) !== null || next.kind === "identifier" || (next.kind === "punct" && next.text === "(")
}

/** The literal token kinds — none starts a statement. */
const LITERAL_KINDS: ReadonlySet<string> = new Set([
  "int_lit", "real_lit", "string_lit", "wstring_lit", "time_lit", "date_lit", "tod_lit", "datetime_lit", "typed_lit",
])

function parseJmp(cur: Cursor): Statement | undefined {
  const kw = cur.consume() // JMP
  const target = parseExpression(cur)
  if (target === undefined) {
    cur.pushError("expected a label after JMP", cur.peek().span)
    return undefined
  }
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
  const tryBody = parseStatementList(cur, (c) => atKeyword(c, "__CATCH", "__FINALLY", "__ENDTRY"))
  let catchVar: Expr | undefined
  let catchBody: StatementList | undefined
  if (cur.eatKeyword("__CATCH") !== undefined) {
    // the operand is optional: `__CATCH` alone builds and runs on both vendors (`stmt_try_catch_without_operand`, ST18)
    if (cur.eatPunct("(") !== undefined) {
      catchVar = parseExpression(cur)
      if (catchVar === undefined) return undefined
      if (cur.expectPunct(")") === undefined) return undefined
    }
    catchBody = parseStatementList(cur, (c) => atKeyword(c, "__FINALLY", "__ENDTRY"))
  }
  let finallyBody: StatementList | undefined
  if (cur.eatKeyword("__FINALLY") !== undefined) {
    finallyBody = parseStatementList(cur, (c) => atKeyword(c, "__ENDTRY"))
  }
  const end = cur.expectKeyword("__ENDTRY") // missing closer: record, keep the parsed bodies
  cur.eatPunct(";")
  return {
    kind: "try",
    tryBody,
    ...(catchVar ? { catchVar } : {}),
    ...(catchBody ? { catchBody } : {}),
    ...(finallyBody ? { finallyBody } : {}),
    span: joinSpans(kw.span, end?.span ?? kw.span),
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
  const end = cur.expectKeyword("END_IF") // missing closer: record, but keep the parsed branches
  cur.eatPunct(";")
  return { kind: "if", branches, elseBody, span: joinSpans(kw.span, end?.span ?? kw.span) }
}

function parseIfBranch(cur: Cursor): IfBranch | undefined {
  const cond = parseAssignable(cur) ?? refusedCondition(cur, "THEN") // `IF x := f() THEN` — inline assignment (CODESYS)
  if (cond === undefined) return undefined
  // Missing-token recovery (Roslyn-style): record the absent THEN but DON'T abandon the branch — parse the
  // body anyway and let the IF consume its END_IF. Bailing here instead dumps the body + END_IF back to the
  // statement list, which mis-parses them into a spurious cascade error. One error in → one error out.
  // A THEN standing further on, before the next `;`, is where the vendor resumes, in silence: `IF a b THEN` and
  // `IF a & b THEN` are "'THEN' expected instead of 'b'" / "… '&'" and nothing else (`expr_if_condition_stray_name`,
  // `expr_ampersand_in_if`, both vendors).
  if (cur.expectKeyword("THEN") === undefined) skipToBeforeSemicolon(cur, "THEN")
  const body = parseStatementList(cur, (c) => atKeyword(c, "ELSIF", "ELSE", "END_IF"))
  return { kind: "if_branch", cond, body, span: joinSpans(cond.span, lastSpan(body, cond.span)) }
}

function parseCase(cur: Cursor): Statement | undefined {
  const kw = cur.consume() // CASE
  // an inline assignment is a selector as it is a condition: `CASE a := b OF` (`expr_inline_assign_case_selector`, E26)
  const selector = parseAssignable(cur)
  if (selector === undefined) return undefined
  cur.expectKeyword("OF") // missing-token recovery — parse the arms regardless (see parseIfBranch)
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
  const end = cur.expectKeyword("END_CASE") // missing closer: record, but keep the parsed arms
  cur.eatPunct(";")
  return { kind: "case", selector, arms, elseBody, span: joinSpans(kw.span, end?.span ?? kw.span) }
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
  const body = parseStatementList(cur, (c) => atKeyword(c, "ELSE", "END_CASE") || isArmStart(c))
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
  if (at.kind === "keyword" || !cur.takeRefusedOperand()) return undefined
  const ahead = keywordAhead(cur, kw)
  if (ahead === undefined) {
    cur.refuseOperand()
    return undefined
  }
  for (let k = 0; k < ahead; k++) cur.consume()
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

function parseFor(cur: Cursor): Statement | undefined {
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
  const body = parseStatementList(cur, (c) => atKeyword(c, "END_FOR"))
  const end = cur.expectKeyword("END_FOR") // missing closer: record, but keep the parsed body
  cur.eatPunct(";")
  return { kind: "for", controlVar, from, to, by, body, span: joinSpans(kw.span, end?.span ?? kw.span) }
}

function parseWhile(cur: Cursor): Statement | undefined {
  const kw = cur.consume() // WHILE
  const cond = parseAssignable(cur) ?? refusedCondition(cur, "DO")
  if (cond === undefined) return undefined
  cur.expectKeyword("DO") // missing-token recovery — parse the body regardless (see parseIfBranch)
  const body = parseStatementList(cur, (c) => atKeyword(c, "END_WHILE"))
  const end = cur.expectKeyword("END_WHILE") // missing closer: record, but keep the parsed body
  cur.eatPunct(";")
  return { kind: "while", cond, body, span: joinSpans(kw.span, end?.span ?? kw.span) }
}

function parseRepeat(cur: Cursor): Statement | undefined {
  const kw = cur.consume() // REPEAT
  const body = parseStatementList(cur, (c) => atKeyword(c, "UNTIL"))
  if (cur.expectKeyword("UNTIL") === undefined) return undefined
  const until = parseAssignable(cur)
  if (until === undefined) return undefined
  const end = cur.expectKeyword("END_REPEAT") // missing closer: record, keep the parsed body
  cur.eatPunct(";")
  return { kind: "repeat", body, until, span: joinSpans(kw.span, end?.span ?? kw.span) }
}

/**
 * The `;` a statement ends with — `undefined` when it is MISSING, and then the statement STANDS, ended where the `;`
 * should be, and the parse resyncs as the vendor does (`resyncAfterMissingSemicolon`).
 *
 * A DECLARATION's initializer does NOT do this: `x : INT := 5 6;` is one message (`cc_decl_init_trailing_int`),
 * which is why this lives here and not in `Cursor.expectPunct`.
 */
function endStatement(cur: Cursor): Token | undefined {
  const semi = cur.eatPunct(";")
  if (semi === undefined) resyncAfterMissingSemicolon(cur)
  return semi
}

/**
 * A STATEMENT WITHOUT ITS `;`, AS THE VENDOR READS IT: "';' expected instead of 'X'", the statement taken as ended
 * there, and the resync from X — `reportStatementCascade`: a pair ("Unexpected token 'X' found" too) for every token
 * no statement can start with, up to the `;` it consumes, and at a NAME the next statement starts. So
 * `out := a ** b ** c;` is a pair for `**`, then `b` read as a statement that itself lacks its `;` — a pair for the
 * second `**` and "The code 'b;' has no effect" — then `c;` (`expr_power_right_assoc`, `cc_power_operator`,
 * `cc_fp_op_ampersand`, `sysop_position_in_expression`, `lit_invalid_digit_hex`, both vendors). End of input is the one
 * line ("';' expected instead of end of POU"), and so is a block keyword (`END_IF` …), left for its block
 * (`stmt_assign_no_semicolon_before_end_if`, `stmt_return_no_semicolon_before_end_if`,
 * `stmt_exit_no_semicolon_before_end_for`, both vendors 2026-10-02 — RETURN, EXIT, CONTINUE and JMP end here too) — every
 * keyword of `STMT_SYNC` but END_REPEAT (no statement stands before it: UNTIL's condition does) asked
 * (`stmt_assign_no_semicolon_before_*`, review 2.6).
 */
function resyncAfterMissingSemicolon(cur: Cursor): void {
  const t = cur.peek()
  if (t.kind === "eof") {
    cur.pushError(`';' expected instead of ${vendorTokenText(t)}`, t.span)
    return
  }
  if (atStatementSync(t)) {
    cur.pushError(`';' expected instead of ${vendorTokenText(t)}`, t.span)
    return
  }
  // where the statement list ends — the next CASE arm's label (`LIST_STOP`): the one line, and the arm is read
  if (LIST_STOP.get(cur)?.(cur) === true) {
    cur.pushError(`';' expected instead of ${vendorTokenText(t)}`, t.span)
    return
  }
  reportStatementCascade(cur, atStatementSync)
}
