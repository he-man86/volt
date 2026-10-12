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

/**
 * THE ENUM VALUE LIST — one parser for an implicit enum (`e : (A, B := 5)`) and a TYPE enum (`TYPE E : (A, B) END_TYPE`),
 * the cursor after the `(`, up to and including its `)`. Each value is a NAME, with an optional `:= <expression>`.
 *
 * What a value that is no name is, on both vendors in both lists: "Identifier expected instead of '5'"
 * (`decl_type_enum_number_name`), and an empty list "Identifier expected instead of ')'" (`decl_implicit_enum_empty`,
 * `decl_type_enum_empty`); the list is then skipped to its next `,` or `)`. ONE difference between the two lists, measured:
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
    const nameTok = c.expectIdent()
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
