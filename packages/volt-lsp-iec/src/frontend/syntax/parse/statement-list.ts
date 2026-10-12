/**
 * THE STATEMENT LIST — a block's part or a body's own list, its recovery past a statement that does not parse, and how a
 * block closes or is LEFT OPEN where its list ends (`closeBlock`). The list parses each statement through the
 * `StatementParser` it is handed (`statements.ts` `parseStatement`): the list sits below the statement grammar that
 * recurses into it (F6, no import cycle in syntax). Split from `statements.ts` (openspec lsp-same-standard design.md §2.2).
 */
import type { StatementList, Statement } from "../ast/nodes/index.js"
import type { Token } from "../lex/tokens.js"
import type { Keyword } from "../lex/vocabulary.js"
import type { Span } from "../span.js"
import { PRAGMAS, type Chain, applyPragmas, compiledOf, UNTERMINATED_CONDITIONAL } from "./body-pragmas.js"
import type { Cursor } from "./cursor.js"
import { vendorTokenText, reportStatementCascade, expectedInsteadOf } from "./errors.js"

export function atKeyword(cur: Cursor, ...kws: Keyword[]): boolean {
  const t = cur.peek()
  return t.kind === "keyword" && t.keyword !== undefined && kws.includes(t.keyword)
}

export function lastSpan(list: ReadonlyArray<{ span: Span }>, fallback: Span): Span {
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
export const atStatementSync = (t: Token): boolean => t.kind === "keyword" && t.keyword !== undefined && STMT_SYNC.includes(t.keyword)

/**
 * The keywords of a block's parts — a next part or a closer. Where no part of an open block is looked for, each is refused
 * as a statement start (`refusedAtStatementStart`): a closer where no block is open (`rec_stray_closer_*`), and an ELSE or
 * an ELSIF after the IF's ELSE, which its ELSE branch refuses and reads on from (`stmt_if_two_else`,
 * `stmt_if_elsif_after_else`) — both vendors.
 */
export const BLOCK_ENDERS: ReadonlySet<string> = new Set([
  "END_IF", "ELSIF", "ELSE", "END_CASE", "END_FOR", "END_WHILE", "END_REPEAT", "UNTIL", "__CATCH", "__FINALLY", "__ENDTRY",
])

/**
 * The CLOSERS among them end EVERY block's list, its own or another block's: an IF whose list meets END_WHILE, or END_FOR
 * inside a FOR, is left open (`rec_end_while_closes_if`, `rec_missing_end_if_in_for`; a REPEAT meeting END_REPEAT before
 * its UNTIL, `rec_missing_until` — both vendors 2026-10-02).
 */
const BLOCK_CLOSERS: ReadonlySet<string> = new Set(["END_IF", "END_CASE", "END_FOR", "END_WHILE", "END_REPEAT", "__ENDTRY"])

const atBlockCloser = (cur: Cursor): boolean => {
  const t = cur.peek()
  return t.kind === "keyword" && BLOCK_CLOSERS.has(t.keyword ?? "")
}

/** The cursors whose innermost block was just LEFT OPEN — every block around it leaves too (`parseStatementList`). */
export const LEFT_OPEN = new WeakSet<Cursor>()

/**
 * What each block still expects where its list ended, in the vendors' words — "Unexpected End-of-file found: <list>
 * expected", the same whether the text ended or another block's ender stood there (`rec_missing_end_*`, both vendors
 * 2026-10-02). One line per block, whichever part is open: an IF in its ELSIF or its ELSE still lists all three, a CASE in
 * its ELSE names END_CASE, a __TRY in its __CATCH or its __FINALLY lists all three (`rec_missing_end_if_after_*`,
 * `rec_missing_end_case_after_else`, `rec_missing_end_try*`). A REPEAT that never reached its UNTIL names its END_REPEAT
 * (`rec_missing_until`).
 */
export const STILL_EXPECTED = {
  if: "'ELSIF', 'ELSE' or 'END_IF'",
  case: "'END_CASE'",
  for: "'END_FOR'",
  while: "'END_WHILE'",
  repeat: "'END_REPEAT'",
  try: "'__CATCH', '__FINALLY' or '__ENDTRY'",
} as const

/** Is the block whose list just ended LEFT OPEN — a block inside it left, the text ended, or another block's ender stands
 *  where its next part belongs? Any other token ends no list: the block's own refusal words it. */
export function leftOpen(cur: Cursor): boolean {
  return LEFT_OPEN.has(cur) || cur.atEof() || atBlockCloser(cur)
}

/** Leave the block: the vendors' line for what it still expected (`STILL_EXPECTED`), and every block around it leaves. */
export function leaveOpen(cur: Cursor, expected: string): void {
  cur.pushError(`Unexpected End-of-file found: ${expected} expected`, cur.peek().span)
  LEFT_OPEN.add(cur)
}

/** The block's closer, and the `;` after it; a block whose list ended elsewhere is left open (`leaveOpen`), and a token
 *  no list ends at is the closer's "'END_X' expected instead of 'T'". */
export function closeBlock(cur: Cursor, closer: Keyword, expected: string): Token | undefined {
  if (!LEFT_OPEN.has(cur)) {
    const end = cur.eatKeyword(closer)
    if (end !== undefined) {
      cur.eatPunct(";")
      return end
    }
  }
  if (leftOpen(cur)) leaveOpen(cur, expected)
  else cur.expectKeyword(closer)
  return undefined
}

/** A statement the parser refused and already resynced past (`reportStatementCascade`) — nothing to add, nothing to skip. */
export const RESYNCED = Symbol("resynced")

/** The statement grammar a list parses each statement with (`statements.ts` `parseStatement`) — handed down, because the
 *  list sits below the grammar that recurses into it (F6). */
export type StatementParser = (cur: Cursor) => Statement | typeof RESYNCED | undefined

/**
 * Where the statement list being parsed ends — its `stop` — for the resync after a missing `;`: a statement whose `;` is
 * missing before the NEXT CASE ARM's label is "';' expected instead of '2'" and nothing else, and the arm is read
 * (`stmt_case_arm_missing_semicolon`, both vendors 2026-10-02). Kept per cursor, the innermost list's.
 */
const LIST_STOP = new WeakMap<Cursor, (cur: Cursor) => boolean>()

/**
 * A statement list ending at `stop` — a block's part when `nested` (the default), the body's own list when not.
 *
 * A BLOCK'S LIST ENDS AT EVERY BLOCK CLOSER (`BLOCK_CLOSERS`), its own or another block's, and at the end of the text; a
 * block whose list ends on anything but its own next part is LEFT OPEN (`closeBlock`) — and so is every block around it,
 * whatever stands there: the vendor leaves them all, and the body's list refuses the ender as a statement start
 * (`rec_missing_end_if_in_for`: END_FOR under an open IF in a FOR is "Unexpected End-of-file found: 'END_FOR' expected",
 * the IF's, "Unexpected token 'END_FOR' found" and "';' expected instead of end of POU" — both vendors 2026-10-02).
 */
export function parseStatementList(cur: Cursor, one: StatementParser, stop: (cur: Cursor) => boolean, nested = true): StatementList {
  const outer = LIST_STOP.get(cur)
  LIST_STOP.set(cur, stop)
  try {
    return parseStatementsUntil(cur, one, stop, nested)
  } finally {
    if (outer === undefined) LIST_STOP.delete(cur)
    else LIST_STOP.set(cur, outer)
  }
}

function parseStatementsUntil(cur: Cursor, one: StatementParser, stop: (cur: Cursor) => boolean, nested: boolean): StatementList {
  const out: Statement[] = []
  const st = PRAGMAS.get(cur)
  const chains: Chain[] = []
  for (;;) {
    if (st !== undefined) applyPragmas(cur, st, chains)
    // a block left open leaves every block around it; the body's own list reads on from where it stopped
    if (LEFT_OPEN.has(cur)) {
      if (nested) break
      LEFT_OPEN.delete(cur)
    }
    if (cur.atEof() || stop(cur) || (nested && atBlockCloser(cur))) break
    const compiled = compiledOf(chains.map((c) => c.compiled))
    if (st !== undefined && compiled !== "on") {
      // a branch not taken, or undecided: parsed in silence, and dropped — kept in the source reading
      st.silent.push(compiled)
      try {
        cur.silently(() => parseListStatement(cur, st.source ? out : [], one))
      } finally {
        st.silent.pop()
        // a block left open in silence leaves nothing around it: its errors were not said
        LEFT_OPEN.delete(cur)
      }
      continue
    }
    parseListStatement(cur, out, one)
  }
  if (chains.length > 0) cur.pushParseError({ message: UNTERMINATED_CONDITIONAL, span: cur.peek().span, unterminatedConditional: true })
  return out
}

/** Parse the next statement of a list into `out`, recovering past one that does not parse. */
function parseListStatement(cur: Cursor, out: Statement[], one: StatementParser): void {
  const before = cur.mark()
  const resumed = cur.takeResumed()
  const s = one(cur)
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
    if (cur.peek().kind === "keyword" || cur.refusedWord(cur.peek())) {
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

/**
 * The `;` a statement ends with — `undefined` when it is MISSING, and then the statement STANDS, ended where the `;`
 * should be, and the parse resyncs as the vendor does (`resyncAfterMissingSemicolon`).
 *
 * A DECLARATION's initializer does NOT do this: `x : INT := 5 6;` is one message (`cc_decl_init_trailing_int`),
 * which is why this lives here and not in `Cursor.expectPunct`.
 */
export function endStatement(cur: Cursor): Token | undefined {
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
export function resyncAfterMissingSemicolon(cur: Cursor): void {
  const t = cur.peek()
  if (t.kind === "eof") {
    cur.pushError(expectedInsteadOf("';'", t), t.span)
    return
  }
  if (atStatementSync(t)) {
    cur.pushError(expectedInsteadOf("';'", t), t.span)
    return
  }
  // where the statement list ends — the next CASE arm's label (`LIST_STOP`): the one line, and the arm is read
  if (LIST_STOP.get(cur)?.(cur) === true) {
    cur.pushError(expectedInsteadOf("';'", t), t.span)
    return
  }
  reportStatementCascade(cur, atStatementSync)
}
