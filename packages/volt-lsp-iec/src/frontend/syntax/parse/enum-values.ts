/**
 * THE ENUM VALUE LIST — one parser for an implicit enum and a TYPE enum, and its recovery past a broken value. Split from
 * `type-expr.ts` (openspec lsp-same-standard design.md §2.2).
 */
import type { EnumValue } from "../ast/nodes/index.js"
import type { Token } from "../lex/tokens.js"
import { joinSpans } from "../span.js"
import type { Cursor } from "./cursor.js"
import { vendorTokenText } from "./errors.js"
import { parseExpression } from "./expression.js"
import { identFromToken } from "./names.js"
import { isRefusedWord } from "../lex/word-sets.js"

/**
 * THE ENUM VALUE LIST — one parser for an implicit enum (`e : (A, B := 5)`) and a TYPE enum (`TYPE E : (A, B) END_TYPE`),
 * the cursor after the `(`, up to and including its `)`. Each value is a NAME, with an optional `:= <expression>`.
 *
 * What a value that is no name is, per list: `readValueName`; the list is then skipped to its next `,` or `)`. The other
 * difference between the two lists, measured:
 * an implicit enum may END IN A COMMA (`decl_implicit_enum_trailing_comma` builds and runs) and a TYPE enum may not
 * (`decl_type_enum_trailing_comma`: "Identifier expected instead of ')'") — `trailingComma`. The two were separate loops
 * that agreed on neither: the implicit one worded a refusal in a sentence of its own ("expected enum value name in
 * implicit enumeration") and stopped dead, the TYPE one accepted the empty list and the trailing comma silently.
 */
export function parseEnumValues(c: Cursor, trailingComma: boolean): { values: EnumValue[]; close?: Token } {
  const values: EnumValue[] = []
  for (;;) {
    const next = c.peek()
    if (trailingComma && values.length > 0 && next.kind === "punct" && next.text === ")") return { values, close: c.consume() }
    const nameTok = readValueName(c, trailingComma)
    if (nameTok === undefined) {
      const at = resyncEnumList(c)
      if (at === ",") continue
      return at === ")" ? { values, close: c.consume() } : { values }
    }
    const name = identFromToken(nameTok)
    // a scalar value expression; parseExpression stops at the `,`/`)` that ends the value
    const assigned = c.eatPunct(":=") !== undefined
    const value = assigned ? parseExpression(c) : undefined
    values.push({
      kind: "enum_value",
      name,
      ...(value !== undefined ? { value } : {}),
      span: value !== undefined ? joinSpans(name.span, value.span) : name.span,
    })
    if (c.eatPunct(",") !== undefined) continue
    const close = c.eatPunct(")")
    if (close !== undefined) return { values, close }
    // a value followed by neither, worded by what could still come (both vendors, a TYPE enum, 2026-10-01): after a bare
    // name a `:=` too — "':=, , or )' expected instead of 'tm_b'" (`decl_type_enum_missing_comma`); after a value's
    // expression only the list — "', or )' expected instead of 'tv_b'" (`decl_type_enum_value_then_name`, and TwinCAT's
    // refused `CHAR#` after `A :=`, `lit_char_typed_in_enum_value`)
    c.pushError(`${assigned ? "', or )'" : "':=, , or )'"} expected instead of ${vendorTokenText(c.peek())}`, c.peek().span)
    const at = resyncEnumList(c)
    if (at === ",") continue
    return at === ")" ? { values, close: c.consume() } : { values }
  }
}

/**
 * A VALUE'S NAME: an identifier or a soft-name keyword — `GET`, `SET` and `OVERRIDE` build clean as values in both lists
 * (`lex_enum_value_get` …, `lex_implicit_enum_value_get` …, `lex_enum_value_get_default`, CODESYS 2026-10-28) — never a
 * refused word (an IL operator's or an elementary type's name, rule R6), nor any other keyword. What anything else is,
 * measured per list on every such word:
 *  - a TYPE enum: "Identifier expected instead of 'X'" — a keyword too, where a declaration says "Unexpected token"
 *    (`lex_enum_value_*`, `decl_type_enum_number_name`);
 *  - an implicit enum: the token is passed and the one AFTER it is refused, "Type definition expected instead of ','"
 *    (`lex_implicit_enum_value_*`, `decl_implicit_enum_number_name`: "… instead of ')'") — but an empty list, where the
 *    token is the `)` itself, is "Identifier expected instead of ')'" (`decl_implicit_enum_empty`).
 * A refused token is passed (the resync stops at a keyword) unless it ends the declaration, which is left to close on.
 */
function readValueName(c: Cursor, implicit: boolean): Token | undefined {
  const t = c.peek()
  const refusedWord = t.kind === "identifier" && isRefusedWord(t.text, c.dialect)
  if (c.atNameStart() && !refusedWord) return c.consume()
  const closes = t.kind === "punct" && t.text === ")"
  if (implicit && !closes && !c.atDeclListEnd()) {
    c.consume()
    const after = c.peek()
    c.pushError(`Type definition expected instead of ${vendorTokenText(after)}`, after.span)
    return undefined
  }
  c.pushError(`Identifier expected instead of ${vendorTokenText(t)}`, t.span)
  if ((t.kind === "keyword" || t.kind === "identifier") && !c.atDeclListEnd()) c.consume()
  return undefined
}

/**
 * Past a broken enum value to the list's next `,` (consumed) or its `)` (left for the caller) — but never past the end of
 * the declaration around it: a `;`, or a keyword that is no operator, stops it unconsumed, so an unclosed implicit list
 * (`e : (a, b;`) costs its own declaration only. Returns where it stopped: `,`, `)`, or `end`.
 */
function resyncEnumList(c: Cursor): "," | ")" | "end" {
  let depth = 0
  while (!c.atEof()) {
    const t = c.peek()
    if (depth === 0 && t.kind === "punct" && t.text === ";") return "end"
    if (t.kind === "keyword" && t.keyword !== undefined && !OPERATOR_WORDS.has(t.keyword)) return "end"
    if (depth === 0 && t.kind === "punct" && t.text === ",") {
      c.consume()
      return ","
    }
    if (depth === 0 && t.kind === "punct" && t.text === ")") return ")"
    if (t.kind === "punct" && (t.text === "(" || t.text === "[")) depth++
    else if (t.kind === "punct" && (t.text === ")" || t.text === "]")) depth--
    c.consume()
  }
  return "end"
}

/** The keywords an expression may hold — the rest end a declaration. */
export const OPERATOR_WORDS: ReadonlySet<string> = new Set(["AND", "AND_THEN", "OR", "OR_ELSE", "XOR", "NOT", "MOD", "TRUE", "FALSE"])
