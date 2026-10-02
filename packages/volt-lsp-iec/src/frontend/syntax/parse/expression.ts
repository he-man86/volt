/**
 * ST EXPRESSIONS — a precedence-climbing (Pratt) parser over a `Cursor`, producing the `Expr` tree of `ast/nodes.ts`.
 *
 * Every function returns `undefined` on failure and records an error on the cursor (never throws); the error reaches
 * the user through the statement or declaration parse that called it (`BodyParse.errors`, `ParseResult.errors`).
 * `parseExprFromTokens` parses a token slice in a CONTAINED sub-cursor, for callers that decide a fallback themselves.
 * Initializers (`:=` right-hand sides, aggregates) are `initializer.ts`'s.
 *
 * Precedence, lowest first: OR/OR_ELSE/XOR < AND/AND_THEN < equality < comparison < additive < multiplicative, every
 * level left-associative, unary (`-` `+` NOT) above them and postfix (`.` `[]` `^` `()`) binding tightest
 * (`BINARY_PRECEDENCE`). Measured level by level on both vendors (rules E1, E3, E4, E6, E7, E9; `expr_*`,
 * `fixtures/grammar/expressions.ts`, 2026-10-01). `**` and `&` are NO operators (E2, E5): the expression ends before
 * them and whatever was reading it says what it expected instead (`REFUSED_OPERATORS`).
 */
import { eofSpan, joinSpans } from "../span.js"
import type { Token } from "../lex/tokens.js"
import { Cursor } from "./cursor.js"
import type { CallArg, CallExpr, Expr, IdentExpr, Literal, LiteralKind } from "../ast/nodes.js"
import { parseLiteralValue } from "../literal/value.js"
import { addressShape } from "../literal/address.js"
import { expectedInsteadOf, vendorExpressionExpected, vendorTokenText } from "./errors.js"
import { CALL_OPERATOR_OPERANDS, NOT_AN_OPERAND, SOFT_NAME_KEYWORDS } from "../lex/vocabulary.js"

// ─── Precedence table (task 1.3) — lowest binding first ──────────────
// Exported for `test/conformance/coverage.test.ts`, which requires every operator here to appear in at least one
// conformance fixture — so an operator the grammar accepts can never again go unmeasured, the way `**` did.
export const BINARY_PRECEDENCE: ReadonlyArray<{
  ops: readonly string[]
  prec: number
}> = [
  // ONE level, not IEC's two: `TRUE OR TRUE XOR TRUE` runs FALSE and `TRUE XOR TRUE OR TRUE` TRUE — left to right
  // (`expr_xor_between_or_and`, `expr_xor_then_or`, `expr_or_else_then_xor`, `expr_xor_then_or_else`, CODESYS run values
  // 2026-10-01). This table had XOR between them, as IEC 61131-3 does.
  { ops: ["OR", "OR_ELSE", "XOR"], prec: 1 },
  { ops: ["AND", "AND_THEN"], prec: 2 },
  { ops: ["=", "<>"], prec: 3 },
  { ops: ["<", ">", "<=", ">="], prec: 4 },
  { ops: ["+", "-"], prec: 5 },
  { ops: ["*", "/", "MOD"], prec: 6 },
]

/**
 * THE IEC OPERATORS NEITHER VENDOR HAS — `**` (EXPT is the only power) and `&` (AND is the only and). Not operators, so
 * an expression ENDS before one, and the reader of the expression says what it expected instead: a statement "';'
 * expected instead of '**'" and the resync after a missing `;`, parentheses "')' expected instead of '&'", a call "',' or
 * ')' expected instead of '&'", an IF "'THEN' expected instead of '&'" (`cc_power_operator`, `cc_fp_op_ampersand`,
 * `expr_power_*`, `expr_ampersand_*`, both vendors). A prefix `&` is no operand (`expr_prefix_ampersand`). Exported so
 * the operator-coverage test still asks a fixture for each (`test/conformance/suite.test.ts`).
 */
export const REFUSED_OPERATORS: readonly string[] = ["**", "&"]

const OP_INFO: ReadonlyMap<string, number> = new Map(BINARY_PRECEDENCE.flatMap((row) => row.ops.map((op) => [op, row.prec] as const)))

/** Keywords that are operators (not names), excluded from primary/ident position. */
const OPERATOR_KEYWORDS: ReadonlySet<string> = new Set([
  "AND",
  "AND_THEN",
  "OR",
  "OR_ELSE",
  "XOR",
  "NOT",
  "MOD",
  "TRUE",
  "FALSE",
])

const LIT_KIND: Partial<Record<Token["kind"], LiteralKind>> = {
  int_lit: "int",
  real_lit: "real",
  string_lit: "string",
  wstring_lit: "wstring",
  time_lit: "time",
  date_lit: "date",
  tod_lit: "tod",
  datetime_lit: "datetime",
  typed_lit: "typed",
  address_lit: "address",
}

/** Canonical operator string for a token, or undefined if it's not a binary operator. */
function binaryOp(t: Token): { op: string; prec: number } | undefined {
  const key = t.kind === "keyword" ? t.keyword : t.kind === "punct" ? t.text : undefined
  if (key === undefined) return undefined
  const prec = OP_INFO.get(key)
  return prec === undefined ? undefined : { op: key, prec }
}

/** Prefix unary operator text, or undefined — `-`, `+` and NOT, stacked in any order (`- -a`, `--a`, `+ +a`, `NOT NOT a`,
 *  `-NOT a`, `NOT -a`: every one builds on both vendors, `expr_*` 2026-10-01). */
function unaryOp(t: Token): string | undefined {
  if (t.kind === "keyword" && t.keyword === "NOT") return "NOT"
  if (t.kind === "punct" && (t.text === "-" || t.text === "+")) return t.text
  return undefined
}

/**
 * A member's name: an identifier, or ANY keyword (rule E32) — the vendor reads `bx.END_IF`, `bx.MOD`, `bx.ABS` as a member
 * access, and answers only that no component has that name, naming the base AS WRITTEN: "'END_IF' is no component of
 * 'bx'", and nothing else about the body (`expr_member_named_*`, both vendors 2026-10-01). A soft name (`GET`, `SET`,
 * `OVERRIDE`) is a name a component CAN bear: `bx.GET` is answered as any unknown member is (`isReservedMemberName`).
 */
function eatName(cur: Cursor): Token | undefined {
  const t = cur.peek()
  if (t.kind === "identifier") return cur.consume()
  if (t.kind === "keyword" && t.keyword !== undefined) return cur.consume()
  return undefined
}

/** A keyword no component can be named — every keyword but the soft names (`eatName`). */
const isReservedMemberName = (t: Token): boolean => t.kind === "keyword" && !SOFT_NAME_KEYWORDS.has(t.keyword ?? "")


/** Parse a full expression. Returns undefined (and records an error) on failure. */
export function parseExpression(cur: Cursor): Expr | undefined {
  return parseBinary(cur, 1)
}

/**
 * A VAR_GENERIC value in `FB<…>` (`decl_var_generic*`): a whole expression in which `>` is no operator, since the list's
 * own `>` closes it — every other operator stands (AND/OR/XOR, `=`, `<`, `>=`), and a `>` inside parentheses is the
 * comparison it is. Only `<6>`, `<6, 7>` and the empty list are recorded, so nothing the `>` does not force is refused.
 * Reports its own errors on `cur`.
 */
export function parseGenericValue(cur: Cursor): Expr | undefined {
  return parseBinary(cur, 1, ">")
}

/**
 * An expression that may be an inline assignment `x := value` (CODESYS). Used where an assignment can
 * legitimately appear in expression position — inside parentheses `(x := y)` and as an IF/WHILE/REPEAT
 * condition `IF x := f() THEN`. NOT used by the general expression parser, so `:=` never hijacks a
 * statement-level assignment. `:=` binds lowest and right, so the whole RHS is captured.
 */
export function parseAssignable(cur: Cursor): Expr | undefined {
  const target = parseExpression(cur)
  if (target === undefined) return undefined
  if (cur.peek().kind === "punct" && cur.peek().text === ":=") {
    cur.consume()
    const value = parseExpression(cur)
    if (value === undefined) return undefined
    return { kind: "assign_expr", target, value, span: joinSpans(target.span, value.span) }
  }
  return target
}

/** `closer` — an operator that closes an enclosing list instead (`>` in `FB<…>`, `parseGenericValue`). */
function parseBinary(cur: Cursor, minPrec: number, closer?: string): Expr | undefined {
  let left = parseUnary(cur)
  if (left === undefined) return undefined
  for (;;) {
    const info = binaryOp(cur.peek())
    if (info === undefined || info.prec < minPrec || info.op === closer) break
    cur.consume()
    const right = parseBinary(cur, info.prec + 1, closer)
    if (right === undefined) return undefined
    left = { kind: "binary", op: info.op, left, right, span: joinSpans(left.span, right.span) }
  }
  return left
}

function parseUnary(cur: Cursor): Expr | undefined {
  const t = cur.peek()
  const op = unaryOp(t)
  if (op !== undefined) {
    cur.consume()
    const operand = parseUnary(cur)
    if (operand === undefined) return undefined
    return { kind: "unary", op, operand, span: joinSpans(t.span, operand.span) }
  }
  return parsePostfix(cur)
}

/** A call of a compiler intrinsic — a callee whose name starts `__` (`__VARINFO(v)`, `__QUERYINTERFACE(…)`). */
const isIntrinsicCall = (e: Expr): boolean => e.kind === "call" && e.callee.kind === "ident_expr" && e.callee.name.startsWith("__")

function parsePostfix(cur: Cursor): Expr | undefined {
  const head = cur.peek()
  let base = parsePrimary(cur)
  if (base === undefined) return undefined
  // A callee written as a KEYWORD (`MAX`, `SEL`, `ADR` …) is an operator's: its list takes no trailing comma (`parseCall`).
  let keywordCallee = head.kind === "keyword" && base.kind === "ident_expr"
  for (;;) {
    const t = cur.peek()
    if (t.kind !== "punct") break
    if (t.text !== "." && t.text !== "[" && t.text !== "^" && t.text !== "(") break
    // A `.`, `[]` or `()` ON A CALL'S RESULT (C0185) is read here and refused by the ANALYSIS
    // (`analysis/checks/calls/call-result-access`), not here: the vendor goes on analysing the body after it — an
    // undefined name in the next statement is still reported (`expr_call_result_index_beside_undefined`, both vendors
    // 2026-10-01) — and a parse error here stops the body's analysis.
    // …but a `.` on a compiler INTRINSIC's result (a `__`-named callee) ENDS the expression: `__VARINFO(v).size` is the
    // call, and the statement then lacks its `;` before the `.` — "';' expected instead of '.'", and `.size;` read on as
    // a statement of its own that has no effect (`op_sys_varinfo`, both vendors; `analysis/resync.ts` modelled it until
    // frontend-conformance 2.8.3 folded it here).
    if (t.text === "." && isIntrinsicCall(base)) break
    if (t.text === ".") {
      const dot = cur.consume()
      // CODESYS bit access `x.0` .. `x.63` — the member is a numeric bit index, not a name.
      const bitTok = cur.peek()
      if (bitTok.kind === "int_lit") {
        cur.consume()
        const member: IdentExpr = { kind: "ident_expr", name: bitTok.text, span: bitTok.span }
        base = { kind: "member", base, member, span: joinSpans(base.span, bitTok.span) }
        continue
      }
      // A `%` where the member's name belongs. CODESYS's partial access `x.%X0` / `.%B3` / `.%W1` / `.%D0` is ONE token,
      // the member's name (`lex/lexer`); a `%` standing alone is TwinCAT's reading of the same text, which has no partial
      // access: the `%` is the member, no component of anything — answered as a keyword member is — and the specifier
      // after it is left over for the statement: "'%' is no component of 'd'", "';' expected instead of 'W0'", "The
      // code 'W0;' has no effect" (`accepts_partial_access`, `operand_partial_*`, TwinCAT 2026-09-21).
      // ANY OTHER TOKEN where the name belongs is taken for it the same way: `bx.;` is "';' is no component of 'bx'", and
      // the `;` gone, "';' expected instead of end of POU" (`rec_member_name_expected`, both vendors 2026-10-02). The END
      // of the text is taken for it too, left in place: `bx.` ending the body is "'' is no component of 'bx'" and
      // "';' expected instead of end of POU" (`rec_member_name_at_end`, both vendors 2026-10-02) — at the `.`, which the
      // expression then ends with (the end of the text has no width to hold the refusal).
      const pct = cur.peek()
      const nameTok = pct.kind === "punct" ? cur.consume() : (eatName(cur) ?? (pct.kind === "eof" ? pct : cur.consume()))
      // …a PARSE refusal: nothing else in the body is analysed, an undefined name beside it included
      // (`expr_member_named_keyword_beside_undefined`, both vendors).
      const at = nameTok.kind === "eof" ? dot.span : nameTok.span
      if ((nameTok.kind !== "identifier" && nameTok.kind !== "keyword") || isReservedMemberName(nameTok))
        cur.pushError(`'${nameTok.text}' is no component of '${cur.textOf(base.span)}'`, at)
      const member: IdentExpr = { kind: "ident_expr", name: nameTok.text, span: at }
      base = { kind: "member", base, member, span: joinSpans(base.span, at) }
    } else if (t.text === "[") {
      cur.consume()
      // Every index is an expression: an empty list `arr[]` and a trailing comma `arr[1,]` are "Expression expected
      // instead of ']'", and nothing else is said (`expr_index_empty`, `expr_trailing_comma_index*`, both vendors).
      const indices: Expr[] = []
      for (;;) {
        const next = cur.peek()
        if (next.kind === "punct" && next.text === "]") {
          cur.pushError(vendorExpressionExpected(next), next.span)
          return undefined
        }
        // …an inline assignment among them: `arr[i := 2]` (`expr_inline_assign_index`, both vendors build it, E26)
        const idx = parseAssignable(cur)
        if (idx === undefined) {
          // a parenthesis left open INSIDE the index (`arr[(1 2)]`): its "')' expected instead of '2'", then the index
          // list's own "',' or ']' expected instead of '2'", which takes the `2` — and the statement resyncs from the
          // token after it, a pair for `)` and for `]` (`expr_paren_stray_name_in_index`, both vendors 2026-10-02)
          const stray = cur.peek()
          const last = cur.getErrors().at(-1)
          const parenOpen = last !== undefined && last.span === stray.span && last.message.startsWith("')' expected")
          if (parenOpen && stray.kind !== "keyword" && stray.kind !== "eof" && cur.takeRefusedOperand()) {
            cur.pushError(`',' or ']' expected instead of ${vendorTokenText(stray)}`, stray.span)
            cur.consume()
            cur.refuseOperand()
          }
          return undefined
        }
        indices.push(idx)
        if (cur.eatPunct(",") === undefined) break
      }
      const close = cur.expectPunct("]")
      if (close === undefined) return undefined
      base = { kind: "index", base, indices, span: joinSpans(base.span, close.span) }
    } else if (t.text === "^") {
      const caret = cur.consume()
      base = { kind: "deref", base, span: joinSpans(base.span, caret.span) }
    } else {
      const call = parseCall(cur, base, keywordCallee)
      if (call === undefined) return undefined
      base = call
    }
    keywordCallee = false
  }
  return base
}

/**
 * A call's argument list. A TRAILING COMMA is taken in a user function's, a method's and a function block's list
 * (`expr_trailing_comma_call`, `_formal_call`, `_fb_call` build on both vendors; pro2193's `ModuloTools` writes one), and
 * refused in an OPERATOR's — a callee written as a keyword: `MAX(a, b,)` is "Expression expected instead of ')'"
 * (`expr_trailing_comma_operator_call`, both vendors).
 */
function parseCall(cur: Cursor, callee: Expr, keywordCallee: boolean): CallExpr | undefined {
  cur.consume() // '('
  const args: CallArg[] = []
  if (!(cur.peek().kind === "punct" && cur.peek().text === ")")) {
    for (;;) {
      const arg = parseCallArg(cur)
      if (arg === undefined) return undefined
      args.push(arg)
      if (cur.eatPunct(",") === undefined) break
      const next = cur.peek()
      if (next.kind === "punct" && next.text === ")") {
        if (!keywordCallee) break
        // …the empty operand after the comma COUNTS: `ABS(a,)` is two operands for ABS's one — "'ABS' needs exactly
        // '1' operands" beside the refusal (`expr_trailing_comma_one_operand_operator`, `expr_trailing_comma_sizeof`,
        // both vendors 2026-10-02); `MAX(a, b,)` is three of at least two, and says nothing more
        operandCountAfterTrailingComma(cur, callee, args.length + 1)
        cur.pushError(vendorExpressionExpected(next), next.span)
        return undefined
      }
    }
  }
  // A CALL's argument list can still take a COMMA here, and CODESYS says so: `',' or ')' expected instead of ';'`
  // (`sysop_position_as_argument`), not the bare `')' expected` a plain `expectPunct` would give.
  const close = cur.eatPunct(")")
  if (close === undefined) {
    const next = cur.peek()
    cur.pushError(`',' or ')' expected instead of ${vendorTokenText(next)}`, next.span)
    return undefined
  }
  return { kind: "call", callee, args, span: joinSpans(callee.span, close.span) }
}

/** The operand count an operator's list breaks by its trailing comma (`CALL_OPERATOR_OPERANDS`), reported on the callee. */
function operandCountAfterTrailingComma(cur: Cursor, callee: Expr, given: number): void {
  if (callee.kind !== "ident_expr") return
  const operator = callee.name.toUpperCase()
  const needed = CALL_OPERATOR_OPERANDS.get(operator)
  if (needed === undefined) return
  const { count, atLeast } = needed
  if (atLeast ? given >= count : given === count) return
  cur.pushParseError({
    message: `'${operator}' needs ${atLeast ? "at least" : "exactly"} '${count}' operands`,
    span: callee.span,
    operandCount: { operator, count, atLeast },
  })
}

function parseCallArg(cur: Cursor): CallArg | undefined {
  // Named input `p := v` or output `p => tgt` — a name followed by := / =>.
  // `atNameStart` (not `kind === "identifier"`): the soft keywords are legal PARAMETER names for the same
  // reason they are legal variable names — the Standard `RS` FB declares `SET : BOOL`, so `rs(SET := x)` is
  // how you call it by name. The declaration side already allowed this (`var-section.ts`); the call side did
  // not, which made that input reachable only positionally.
  if (cur.atNameStart()) {
    const next = cur.peek(1)
    if (next.kind === "punct" && (next.text === ":=" || next.text === "=>")) {
      const nameTok = cur.consume()
      const opTok = cur.consume()
      const output = opTok.text === "=>"
      const param: IdentExpr = { kind: "ident_expr", name: nameTok.text, span: nameTok.span }
      // Either side may be left unconnected: `out => ,` / `in := ,` / `… )`. CODESYS accepts an
      // empty input (routed from nowhere) as well as an empty output.
      const after = cur.peek()
      if (after.kind === "punct" && (after.text === "," || after.text === ")")) {
        return { kind: "call_arg", param, output, span: joinSpans(nameTok.span, opTok.span) }
      }
      const value = loneRefusedWord(cur) ?? parseExpression(cur)
      if (value === undefined) return undefined
      return { kind: "call_arg", param, output, value, span: joinSpans(nameTok.span, value.span) }
    }
  }
  const value = loneRefusedWord(cur) ?? parseExpression(cur)
  if (value === undefined) return undefined
  return { kind: "call_arg", output: false, value, span: value.span }
}

/** A refused word that IS the whole argument — `XSIZEOF(DINT)` names a type — taken as the name it is (rule R6). */
function loneRefusedWord(cur: Cursor): IdentExpr | undefined {
  const t = cur.peek()
  const after = cur.peek(1)
  if (!cur.refusedWord(t) || after.kind !== "punct" || (after.text !== "," && after.text !== ")")) return undefined
  cur.consume()
  return { kind: "ident_expr", name: t.text, span: t.span }
}

const isOpenParen = (t: Token): boolean => t.kind === "punct" && t.text === "("

/** The punctuation an operand can start with — a parenthesis and the two signs. */
const OPERAND_STARTS: ReadonlySet<string> = new Set(["(", "-", "+"])

/** The address shapes that are no operand: complete only after AT (`%I*`), or no address at all (`%MW`). */
const NO_OPERAND_ADDRESS: ReadonlySet<string> = new Set(["incomplete", "no-position"])

function parsePrimary(cur: Cursor): Expr | undefined {
  const t = cur.peek()
  const lk = LIT_KIND[t.kind]
  // A MALFORMED literal (`Token.malformed`) is refused as a keyword that is no operand is, and left where it stands for
  // the statement's resync: "Expression expected instead of '3#'", then the pair and a pair per token to the `;`
  // (`lit_invalid_base_3`, `lit_int_typed_plus`, `cc_time_nanosecond_literal`, both vendors).
  // An INCOMPLETE address (`%I*`) is refused the same way where it is an operand — it is completed by a VAR_CONFIG,
  // so it belongs after `AT` only (`lit_address_incomplete_in_body`, both vendors 2026-10-01). So is one with a size
  // and NO POSITION (`%MW`; `%IW*` is `%IW` then `*`), which is no address at all (`lit_address_no_position_in_body`,
  // `lit_address_sized_star_in_body`, CODESYS 2026-10-01).
  if (lk !== undefined && (t.malformed || (lk === "address" && NO_OPERAND_ADDRESS.has(addressShape(t.text).kind)))) {
    cur.pushError(vendorExpressionExpected(t), t.span)
    cur.refuseOperand()
    return undefined
  }
  if (lk !== undefined) {
    cur.consume()
    return makeLiteral(lk, t)
  }
  if (t.kind === "keyword" && (t.keyword === "TRUE" || t.keyword === "FALSE")) {
    cur.consume()
    return makeLiteral("bool", t)
  }
  // A REFUSED WORD as an operand (`isRefusedWord`, rule R6) is refused as a keyword that is no operand is, and left where
  // it stands for the statement's resync from it: `n + dint + 1` is "Expression expected instead of 'dint'", then the pair
  // for `dint` and a pair per token to the `;` (`rec_refused_name_cascade_type_word`, `cc4_type_name_*`, both vendors).
  // A callee is none (`LTIME()`); a lone argument neither (`parseCallArg`).
  if (cur.refusedWord(t) && !isOpenParen(cur.peek(1))) {
    cur.pushError(vendorExpressionExpected(t), t.span)
    cur.refuseOperand()
    return undefined
  }
  if (t.kind === "identifier") {
    cur.consume()
    return { kind: "ident_expr", name: t.text, span: t.span }
  }
  // Every keyword rule below was measured with a token AFTER the word (`n := cal;`). A keyword that ENDS the tokens is
  // read as a name, as before: network text reads a callee on its own (`MAX` of `MAX(a, b)`), and a stray block closer
  // at the end of a body is unmeasured.
  const followed = cur.peek(1).kind !== "eof"
  // A keyword that is NO OPERAND (`NOT_AN_OPERAND`) — `n := cal;`, `t(Public := TRUE);` — is refused on the word and
  // left where it stands: the vendor resyncs from it as from a refused statement, which the statement list runs. So is
  // the IL CALL FORM of the operators among them (rule E31): `ADD(a, b)`, `gt(a, b)` — "Expression expected instead of
  // 'ADD'", then the pair for it and the statement resync over `(a, b)` (`operator_call_form_*`,
  // `expr_operator_call_form_lower_case`, both vendors).
  if (t.kind === "keyword" && t.keyword !== undefined && NOT_AN_OPERAND.has(t.keyword) && followed) {
    cur.pushError(vendorExpressionExpected(t), t.span)
    cur.refuseOperand()
    return undefined
  }
  // A CALL OPERATOR WITHOUT ITS `(` TAKES THE NEXT TOKEN FOR IT (`CALL_OPERATOR_OPERANDS`): `n := abs;` is "'(' expected
  // instead of ';'" and "'ABS' needs exactly '1' operands", and the `;` is gone — so the statement then says "';'
  // expected instead of end of POU" by itself, as for `__POSITION` below. Measured per operator (`lex_keyword_operand_*`,
  // `lex_keyword_assigned_sys_queryinterface` …, CODESYS 2026-09-30).
  const operands = t.kind === "keyword" && t.keyword !== undefined ? CALL_OPERATOR_OPERANDS.get(t.keyword) : undefined
  if (t.keyword !== undefined && operands !== undefined && followed && !isOpenParen(cur.peek(1))) {
    cur.consume()
    const taken = cur.peek()
    cur.pushError(`'(' expected instead of ${vendorTokenText(taken)}`, taken.span)
    const operator = t.keyword
    const { count, atLeast } = operands
    cur.pushParseError({
      message: `'${operator}' needs ${atLeast ? "at least" : "exactly"} '${count}' operands`,
      span: t.span,
      operandCount: { operator, count, atLeast },
    })
    cur.consume()
    return { kind: "ident_expr", name: t.text, span: t.span }
  }
  // `__NEW` WITHOUT ITS `(` takes the next token for it too, then wants a TYPE where the calls above want operands:
  // `n := __new;` is "'(' expected instead of ';'", "Type definition expected as operand for __NEW", "')' expected
  // instead of ''" — and the `;` gone, the statement's "';' expected instead of end of POU" (`lex_keyword_operand_sys_new`,
  // CODESYS and TwinCAT alike, 2026-09-30). Only that position was measured.
  if (t.kind === "keyword" && t.keyword === "__NEW" && followed && !isOpenParen(cur.peek(1))) {
    cur.consume()
    const taken = cur.consume()
    cur.pushError(`'(' expected instead of ${vendorTokenText(taken)}`, taken.span)
    const next = cur.peek()
    cur.pushError("Type definition expected as operand for __NEW", next.span)
    cur.pushError(`')' expected instead of ${next.kind === "eof" ? "''" : vendorTokenText(next)}`, next.span)
    return { kind: "ident_expr", name: t.text, span: t.span }
  }
  // A BINARY OPERATOR WORD where an operand belongs is read as the operator, its left operand missing: CODESYS names the
  // word, then — having taken it as the operator — reads its right operand, or names the token where it should be
  // (`n := and;`: "Expression expected instead of 'and'", "Expression expected instead of ';'"; `lex_keyword_operand_and`
  // and its five siblings). Its IL call form is that too: `MOD(a, b)` reads `(a` as the operand — "')' expected instead
  // of ','" and the statement's resync from the `,` (`expr_operator_call_form_mod`, `_and`, both vendors).
  if (t.kind === "keyword" && binaryOp(t) !== undefined && followed) {
    cur.pushError(vendorExpressionExpected(t), t.span)
    cur.consume()
    const operand = cur.peek()
    if (operand.kind === "punct" && !OPERAND_STARTS.has(operand.text)) cur.pushError(vendorExpressionExpected(operand), operand.span)
    else parseUnary(cur)
    return undefined
  }
  // A keyword that isn't an operator can start an expression as a name —
  // standard functions/operators lexed as keywords (`ADR`, `SIZEOF`, `SEL`, …).
  if (t.kind === "keyword" && t.keyword !== undefined && !OPERATOR_KEYWORDS.has(t.keyword)) {
    cur.consume()
    // `__POSITION` IS A CALL, AND WITHOUT ITS PARENTHESES THE COMPILER EATS THE NEXT TOKEN. Seven positions were
    // recorded on SP21 (`sysop_position_*`) and every answer follows from that one rule:
    //
    //   here := __POSITION();     the call form — STRING(INT#23) into a DINT, and NOTHING else is wrong
    //   here := __POSITION;       eats the `;`  -> "';' expected instead of end of POU"
    //   here := __POSITION; …     eats the `;`  -> "';' expected instead of 'after'" (the next statement's name)
    //   here := __POSITION + 1;   eats the `+`  -> "';' expected instead of '1'"
    //   here := ABS(__POSITION);  eats the `)`  -> "',' or ')' expected instead of ';'"
    //
    // Modelling it as "an unknown operand" fits none of them: the compiler never names `__POSITION`, it names
    // whatever stands after it. Emulating the bite makes the ordinary statement parser say the vendor's words.
    //
    // `__POUNAME` answers the same way (`lex_keyword_operand_sys_pouname`, CODESYS 2026-09-30: `n := __pouname;` is
    // "';' expected instead of end of POU" and nothing else). On TwinCAT neither is a keyword (`CODESYS_ONLY_KEYWORDS`).
    if ((t.keyword === "__POSITION" || t.keyword === "__POUNAME") && !isOpenParen(cur.peek())) cur.consume()
    // `__CURRENTTASK` IS REFUSED IN ST, AND ALWAYS WITH THE SAME TWO WORDS. Six positions were recorded on SP21
    // (`op_sys_currenttask`, `sysop_currenttask_*`) — a method, an FB body, a bare statement, the call form, a
    // dereference-and-read, and one with a statement after it — and every one answers:
    //
    //   ';' expected instead of end of POU
    //   Expression expected instead of ''
    //
    // Both name the END of the input whatever stood in the way, so the compiler runs off the end of the POU on
    // this token and nothing after it is read. The parse CONTINUES here rather than doing that: the two messages
    // are the whole answer, and swallowing the rest of the unit would invent a cascade CODESYS does not report.
    if (t.keyword === "__CURRENTTASK") pushEndOfText(cur, t)
    return { kind: "ident_expr", name: t.text, span: t.span }
  }
  // THE GLOBAL-NAMESPACE OPERATOR, a leading dot: `.gv` (rule E33, `GlobalExpr`) — a space may stand between the two
  // (`expr_global_namespace_space`, both vendors). Measured before a name only.
  if (t.kind === "punct" && t.text === "." && cur.peek(1).kind === "identifier") {
    const dot = cur.consume()
    const nameTok = cur.consume()
    const name: IdentExpr = { kind: "ident_expr", name: nameTok.text, span: nameTok.span }
    return { kind: "global_expr", name, span: joinSpans(dot.span, nameTok.span) }
  }
  if (t.kind === "punct" && t.text === "(") {
    const open = cur.consume()
    // `()` is the one "Expression expected instead of ')'" (`expr_paren_empty`, both vendors)
    const empty = cur.peek()
    if (empty.kind === "punct" && empty.text === ")") {
      cur.pushError(vendorExpressionExpected(empty), empty.span)
      return undefined
    }
    // Allow an inline assignment `(x := value)` inside the parens (CODESYS).
    const inner = parseAssignable(cur)
    if (inner === undefined) return undefined
    // A parenthesis left open where something else stands is "')' expected instead of 'X'", and the statement then
    // resyncs from X as after a missing `;` (`expr_paren_stray_name`: "';' expected instead of 'b'" and `b;` read on;
    // `expr_ampersand_in_parens`, `expr_power_in_parens`, both vendors).
    const close = cur.expectPunct(")")
    if (close === undefined) {
      cur.refuseOperand()
      return undefined
    }
    return { kind: "paren", inner, span: joinSpans(open.span, close.span) }
  }
  // A prefix `&` is no operand: "Expression expected instead of '&'", then the statement's resync from it — the pair for
  // `&`, and the name after it read as a statement of its own (`expr_prefix_ampersand`, both vendors).
  if (t.kind === "punct" && t.text === "&") {
    cur.pushError(vendorExpressionExpected(t), t.span)
    cur.refuseOperand()
    return undefined
  }
  // THE END OF THE TEXT where an operand belongs is the vendors' two lines, the `;` first: `out := 1 +` at the end of
  // the body is "';' expected instead of end of POU" and "Expression expected instead of ''"
  // (`rec_expected_expression_end_of_pou`, both vendors 2026-10-02) — `__CURRENTTASK`'s pair, below.
  if (t.kind === "eof") pushEndOfText(cur, t)
  else cur.pushError(vendorExpressionExpected(t), t.span)
  return undefined
}

/** The vendors' two lines for an operand the end of the text took the place of. */
function pushEndOfText(cur: Cursor, at: Token): void {
  cur.pushError(expectedInsteadOf("';'", { ...at, kind: "eof" }), at.span)
  cur.pushError(vendorExpressionExpected({ ...at, kind: "eof" }), at.span)
}

/** Build a `Literal` node with its value parsed up front (kills re-lexing downstream). */
function makeLiteral(literalKind: LiteralKind, tok: Token): Literal {
  const { value, prefix } = parseLiteralValue(literalKind, tok.text)
  return {
    kind: "literal",
    literalKind,
    text: tok.text,
    value,
    ...(prefix !== undefined ? { prefix } : {}),
    span: tok.span,
  }
}

/**
 * Parse a token slice as a single expression in a CONTAINED sub-cursor, so a speculative
 * failure never pollutes the caller's error list. Returns the `Expr` only if it consumes
 * every token cleanly; otherwise `undefined` (the caller decides the fallback). Used for
 * structured-but-tolerant bounds (subrange/array-dim) and scalar initializers.
 * `assignable` reads it as a condition is read (`parseAssignable`): an inline assignment stands bare.
 */
export function parseExprFromTokens(tokens: readonly Token[], assignable = false): Expr | undefined {
  if (tokens.length === 0) return undefined
  const first = tokens[0]
  const last = tokens[tokens.length - 1]
  const span = joinSpans(first.span, last.span)
  const eof: Token = { kind: "eof", text: "", span: eofSpan(span) }
  const cur = new Cursor([...tokens, eof])
  const expr = assignable ? parseAssignable(cur) : parseExpression(cur)
  return expr !== undefined && cur.atEof() && cur.getErrors().length === 0 ? expr : undefined
}
