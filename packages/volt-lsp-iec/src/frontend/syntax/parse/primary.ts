/**
 * THE OPERAND — what an expression's innermost position holds: a literal, a name, a keyword read as a name (`ADR`,
 * `SIZEOF`), the global-namespace `.name`, a parenthesised expression — and the vendors' refusal of everything else
 * that stands there. Split from `expression.ts` (openspec lsp-same-standard design.md §2.2); the operand recurses into
 * the expression grammar through the `ExpressionGrammar` it is handed (F6, no import cycle in syntax).
 */
import type { Expr, IdentExpr, Literal, LiteralKind } from "../ast/nodes/index.js"
import type { Token } from "../lex/tokens.js"
import { CALL_OPERATOR_OPERANDS, NOT_AN_OPERAND } from "../lex/word-sets.js"
import { addressShape } from "../literal/address.js"
import { parseLiteralValue } from "../literal/value.js"
import { joinSpans } from "../span.js"
import type { Cursor } from "./cursor.js"
import { expectedInsteadOf, vendorExpressionExpected, vendorTokenText } from "./errors.js"
import { binaryOp } from "./precedence.js"

/** The expression grammar an operand recurses into — handed down from `expression.ts`, which sits above the operand
 *  parsers in the syntax DAG (F6). */
export interface ExpressionGrammar {
  readonly expression: (cur: Cursor) => Expr | undefined
  readonly assignable: (cur: Cursor) => Expr | undefined
  readonly unary: (cur: Cursor) => Expr | undefined
}

/** A sub-parser's answer that the token is not its to read. */
const NOT_HERE = Symbol("not-here")
type Operand = Expr | undefined | typeof NOT_HERE

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

const isOpenParen = (t: Token): boolean => t.kind === "punct" && t.text === "("

/** The punctuation an operand can start with — a parenthesis and the two signs. */
const OPERAND_STARTS: ReadonlySet<string> = new Set(["(", "-", "+"])

/** The address shapes that are no operand: complete only after AT (`%I*`), or no address at all (`%MW`). */
const NO_OPERAND_ADDRESS: ReadonlySet<string> = new Set(["incomplete", "no-position"])

export function parsePrimary(cur: Cursor, g: ExpressionGrammar): Expr | undefined {
  const t = cur.peek()
  const literal = literalOperand(cur, t)
  if (literal !== NOT_HERE) return literal
  // A REFUSED WORD as an operand (`isRefusedWord`, rule R6) is refused as a keyword that is no operand is, and left where
  // it stands for the statement's resync from it: `n + dint + 1` is "Expression expected instead of 'dint'", then the pair
  // for `dint` and a pair per token to the `;` (`rec_refused_name_cascade_type_word`, `cc4_type_name_*`, both vendors).
  // A callee is none (`LTIME()`); a lone argument neither (`parseCallArg`).
  if (cur.refusedWord(t) && !isOpenParen(cur.peek(1))) return refuseOperand(cur, t)
  if (t.kind === "identifier") {
    cur.consume()
    return { kind: "ident_expr", name: t.text, span: t.span }
  }
  if (t.kind === "keyword") {
    const refused = refusedKeywordOperand(cur, t, g)
    if (refused !== NOT_HERE) return refused
    const name = keywordName(cur, t)
    if (name !== NOT_HERE) return name
  }
  if (t.kind === "punct") {
    const punct = punctOperand(cur, t, g)
    if (punct !== NOT_HERE) return punct
  }
  // THE END OF THE TEXT where an operand belongs is the vendors' two lines, the `;` first: `out := 1 +` at the end of
  // the body is "';' expected instead of end of POU" and "Expression expected instead of ''"
  // (`rec_expected_expression_end_of_pou`, both vendors 2026-10-02) — `__CURRENTTASK`'s pair, below.
  if (t.kind === "eof") pushEndOfText(cur, t)
  else cur.pushError(vendorExpressionExpected(t), t.span)
  return undefined
}

/** "Expression expected instead of 'X'", X left where it stands for the statement's resync (`Cursor.refuseOperand`). */
function refuseOperand(cur: Cursor, t: Token): undefined {
  cur.pushError(vendorExpressionExpected(t), t.span)
  cur.refuseOperand()
  return undefined
}

/** A literal operand, TRUE and FALSE among them — or its refusal. */
function literalOperand(cur: Cursor, t: Token): Operand {
  const lk = LIT_KIND[t.kind]
  // A MALFORMED literal (`Token.malformed`) is refused as a keyword that is no operand is, and left where it stands for
  // the statement's resync: "Expression expected instead of '3#'", then the pair and a pair per token to the `;`
  // (`lit_invalid_base_3`, `lit_int_typed_plus`, `cc_time_nanosecond_literal`, both vendors).
  // An INCOMPLETE address (`%I*`) is refused the same way where it is an operand — it is completed by a VAR_CONFIG,
  // so it belongs after `AT` only (`lit_address_incomplete_in_body`, both vendors 2026-10-01). So is one with a size
  // and NO POSITION (`%MW`; `%IW*` is `%IW` then `*`), which is no address at all (`lit_address_no_position_in_body`,
  // `lit_address_sized_star_in_body`, CODESYS 2026-10-01).
  if (lk !== undefined && (t.malformed || (lk === "address" && NO_OPERAND_ADDRESS.has(addressShape(t.text).kind)))) return refuseOperand(cur, t)
  if (lk !== undefined) {
    cur.consume()
    return makeLiteral(lk, t)
  }
  if (t.kind === "keyword" && (t.keyword === "TRUE" || t.keyword === "FALSE")) {
    cur.consume()
    return makeLiteral("bool", t)
  }
  return NOT_HERE
}

/**
 * A keyword where an operand belongs that the vendors refuse, each in its own words.
 *
 * Every keyword rule below was measured with a token AFTER the word (`n := cal;`). A keyword that ENDS the tokens is
 * read as a name, as before: network text reads a callee on its own (`MAX` of `MAX(a, b)`), and a stray block closer
 * at the end of a body is unmeasured.
 */
function refusedKeywordOperand(cur: Cursor, t: Token, g: ExpressionGrammar): Operand {
  const followed = cur.peek(1).kind !== "eof"
  if (t.keyword === undefined || !followed) return NOT_HERE
  // A keyword that is NO OPERAND (`NOT_AN_OPERAND`) — `n := cal;`, `t(Public := TRUE);` — is refused on the word and
  // left where it stands: the vendor resyncs from it as from a refused statement, which the statement list runs. So is
  // the IL CALL FORM of the operators among them (rule E31): `ADD(a, b)`, `gt(a, b)` — "Expression expected instead of
  // 'ADD'", then the pair for it and the statement resync over `(a, b)` (`operator_call_form_*`,
  // `expr_operator_call_form_lower_case`, both vendors).
  if (NOT_AN_OPERAND.has(t.keyword)) return refuseOperand(cur, t)
  // A CALL OPERATOR WITHOUT ITS `(` TAKES THE NEXT TOKEN FOR IT (`CALL_OPERATOR_OPERANDS`): `n := abs;` is "'(' expected
  // instead of ';'" and "'ABS' needs exactly '1' operands", and the `;` is gone — so the statement then says "';'
  // expected instead of end of POU" by itself, as for `__POSITION` below. Measured per operator (`lex_keyword_operand_*`,
  // `lex_keyword_assigned_sys_queryinterface` …, CODESYS 2026-09-30).
  const operands = CALL_OPERATOR_OPERANDS.get(t.keyword)
  if (operands !== undefined && !isOpenParen(cur.peek(1))) {
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
  if (t.keyword === "__NEW" && !isOpenParen(cur.peek(1))) {
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
  if (binaryOp(t) !== undefined) {
    cur.pushError(vendorExpressionExpected(t), t.span)
    cur.consume()
    const operand = cur.peek()
    if (operand.kind === "punct" && !OPERAND_STARTS.has(operand.text)) cur.pushError(vendorExpressionExpected(operand), operand.span)
    else g.unary(cur)
    return undefined
  }
  return NOT_HERE
}

/**
 * A keyword that isn't an operator can start an expression as a name —
 * standard functions/operators lexed as keywords (`ADR`, `SIZEOF`, `SEL`, …).
 */
function keywordName(cur: Cursor, t: Token): Operand {
  if (t.keyword === undefined || OPERATOR_KEYWORDS.has(t.keyword)) return NOT_HERE
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

/** An operand that starts with punctuation: the global-namespace `.name`, a parenthesised expression — or a prefix `&`. */
function punctOperand(cur: Cursor, t: Token, g: ExpressionGrammar): Operand {
  // THE GLOBAL-NAMESPACE OPERATOR, a leading dot: `.gv` (rule E33, `GlobalExpr`) — a space may stand between the two
  // (`expr_global_namespace_space`, both vendors). Measured before a name only.
  if (t.text === "." && cur.peek(1).kind === "identifier") {
    const dot = cur.consume()
    const nameTok = cur.consume()
    const name: IdentExpr = { kind: "ident_expr", name: nameTok.text, span: nameTok.span }
    return { kind: "global_expr", name, span: joinSpans(dot.span, nameTok.span) }
  }
  if (t.text === "(") {
    const open = cur.consume()
    // `()` is the one "Expression expected instead of ')'" (`expr_paren_empty`, both vendors)
    const empty = cur.peek()
    if (empty.kind === "punct" && empty.text === ")") {
      cur.pushError(vendorExpressionExpected(empty), empty.span)
      return undefined
    }
    // Allow an inline assignment `(x := value)` inside the parens (CODESYS).
    const inner = g.assignable(cur)
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
  if (t.text === "&") return refuseOperand(cur, t)
  return NOT_HERE
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
