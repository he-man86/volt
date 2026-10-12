/**
 * THE POSTFIX SUFFIXES — what binds tightest after an operand: a member `.name` (and CODESYS's bit access `.0`), an
 * index `[i, j]`, a dereference `^`, a call `(args)` with its argument list. Split from `expression.ts` (openspec
 * lsp-same-standard design.md §2.2); recurses into the expression grammar through the `ExpressionGrammar` it is handed.
 */
import type { CallArg, CallExpr, Expr, IdentExpr } from "../ast/nodes/index.js"
import type { Token } from "../lex/tokens.js"
import { CALL_OPERATOR_OPERANDS, SOFT_NAME_KEYWORDS } from "../lex/word-sets.js"
import { joinSpans } from "../span.js"
import type { Cursor } from "./cursor.js"
import { vendorExpressionExpected, vendorTokenText } from "./errors.js"
import { parsePrimary, type ExpressionGrammar } from "./primary.js"

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

/** A call of a compiler intrinsic — a callee whose name starts `__` (`__VARINFO(v)`, `__QUERYINTERFACE(…)`). */
const isIntrinsicCall = (e: Expr): boolean => e.kind === "call" && e.callee.kind === "ident_expr" && e.callee.name.startsWith("__")

export function parsePostfix(cur: Cursor, g: ExpressionGrammar): Expr | undefined {
  const head = cur.peek()
  let base = parsePrimary(cur, g)
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
    // a statement of its own that has no effect (`op_sys_varinfo`, both vendors; the old `analysis/resync` module modelled it until
    // frontend-conformance 2.8.3 folded it here).
    if (t.text === "." && isIntrinsicCall(base)) break
    let next: Expr | undefined
    if (t.text === ".") next = parseMember(cur, base)
    else if (t.text === "[") next = parseIndex(cur, base, g)
    else if (t.text === "^") {
      const caret = cur.consume()
      next = { kind: "deref", base, span: joinSpans(base.span, caret.span) }
    } else next = parseCall(cur, base, keywordCallee, g)
    if (next === undefined) return undefined
    base = next
    keywordCallee = false
  }
  return base
}

/** The member after a `.` on `base`. */
function parseMember(cur: Cursor, base: Expr): Expr {
  const dot = cur.consume()
  // CODESYS bit access `x.0` .. `x.63` — the member is a numeric bit index, not a name.
  const bitTok = cur.peek()
  if (bitTok.kind === "int_lit") {
    cur.consume()
    const member: IdentExpr = { kind: "ident_expr", name: bitTok.text, span: bitTok.span }
    return { kind: "member", base, member, span: joinSpans(base.span, bitTok.span) }
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
  return { kind: "member", base, member, span: joinSpans(base.span, at) }
}

/** The index list after a `[` on `base`. */
function parseIndex(cur: Cursor, base: Expr, g: ExpressionGrammar): Expr | undefined {
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
    const idx = g.assignable(cur)
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
  return { kind: "index", base, indices, span: joinSpans(base.span, close.span) }
}

/**
 * A call's argument list. A TRAILING COMMA is taken in a user function's, a method's and a function block's list
 * (`expr_trailing_comma_call`, `_formal_call`, `_fb_call` build on both vendors; pro2193's `ModuloTools` writes one), and
 * refused in an OPERATOR's — a callee written as a keyword: `MAX(a, b,)` is "Expression expected instead of ')'"
 * (`expr_trailing_comma_operator_call`, both vendors).
 */
function parseCall(cur: Cursor, callee: Expr, keywordCallee: boolean, g: ExpressionGrammar): CallExpr | undefined {
  cur.consume() // '('
  const args: CallArg[] = []
  if (!(cur.peek().kind === "punct" && cur.peek().text === ")")) {
    for (;;) {
      const arg = parseCallArg(cur, g)
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

function parseCallArg(cur: Cursor, g: ExpressionGrammar): CallArg | undefined {
  // Named input `p := v` or output `p => tgt` — a name followed by := / =>.
  // `atNameStart` (not `kind === "identifier"`): the soft keywords are legal PARAMETER names for the same
  // reason they are legal variable names — the Standard `RS` FB declares `SET : BOOL`, so `rs(SET := x)` is
  // how you call it by name. The declaration side already allowed this (`parse/declarations.ts`); the call side did
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
      const value = loneRefusedWord(cur) ?? g.expression(cur)
      if (value === undefined) return undefined
      return { kind: "call_arg", param, output, value, span: joinSpans(nameTok.span, value.span) }
    }
  }
  const value = loneRefusedWord(cur) ?? g.expression(cur)
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
