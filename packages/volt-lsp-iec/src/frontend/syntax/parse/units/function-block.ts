/**
 * `FUNCTION_BLOCK Name [FINAL|ABSTRACT] [EXTENDS Base] [IMPLEMENTS …]
 *  <var-sections>
 *  <body>
 *  END_FUNCTION_BLOCK`
 *
 * Modifiers `FINAL` / `ABSTRACT` may appear in either order between the
 * keyword and the name. `EXTENDS` (single base) and `IMPLEMENTS`
 * (comma list) are both optional.
 */
import type { FunctionBlock, Identifier } from "../../ast/nodes.js"
import type { Cursor } from "../cursor.js"
import { collectBodyUntil } from "../body.js"
import { FB_MODIFIERS } from "../../lex/vocabulary.js"
import { joinSpans } from "../../span.js"
import { identFromToken, readIdent, readModifiers, readNameList } from "../names.js"
import { collectVarSections } from "../declarations.js"
import { readImplements } from "./header.js"

export function parseFunctionBlock(c: Cursor): FunctionBlock | undefined {
  const start = c.expectKeyword("FUNCTION_BLOCK")
  if (start === undefined) return undefined

  // Optional modifiers before name (any order): access (PUBLIC/PRIVATE/PROTECTED/INTERNAL),
  // FINAL, ABSTRACT — real CODESYS code writes e.g. `FUNCTION_BLOCK PUBLIC FB_X`.
  let accessModifier: FunctionBlock["accessModifier"]
  let isFinal = false
  let isAbstract = false
  // A modifier keyword is a modifier only when a name (or another modifier) follows it; otherwise it IS the name
  // (`FUNCTION_BLOCK PUBLIC Final`). The `IMPLEMENTATION` line is an identifier token but never a name — it ends the
  // declaration, and an FB with no VAR puts it straight under the header — so it does not count as one. Eating
  // greedily named such an FB `IMPLEMENTATION` (the method header's twin, `parseMethod`).
  const modifiers = readModifiers(
    c,
    FB_MODIFIERS,
    (after) =>
      (after.kind === "identifier" && !c.opensImplementationLine(1)) ||
      (after.kind === "keyword" && after.keyword !== undefined && FB_MODIFIERS.includes(after.keyword)),
  )
  for (const mod of modifiers) {
    if (
      mod.keyword === "PUBLIC" ||
      mod.keyword === "PRIVATE" ||
      mod.keyword === "PROTECTED" ||
      mod.keyword === "INTERNAL"
    ) {
      accessModifier = mod.keyword
    } else if (mod.keyword === "FINAL") isFinal = true
    else if (mod.keyword === "ABSTRACT") isAbstract = true
  }

  // `expectName`, as a method's: a modifier keyword the loop above left is the FB's name.
  const nameTok = c.expectName()
  if (nameTok === undefined) return undefined
  const name = identFromToken(nameTok)

  // Optional EXTENDS X. FBs are single-inheritance, but a stray `EXTENDS A, B` appears in error cases —
  // capture the illegal extra bases (rather than leaving `, B` to corrupt the following var-sections) so a
  // check can emit C0096.
  let extendsName: Identifier | undefined
  let extendsExtra: Identifier[] | undefined
  if (c.eatKeyword("EXTENDS") !== undefined) {
    extendsName = readIdent(c)
    const more = readNameList(c, () => readIdent(c))
    if (more.length > 0) extendsExtra = more
  }

  // Optional IMPLEMENTS X, Y, Z
  const implementsList = readImplements(c)

  // Some CODESYS exports terminate the FB header with a stray `;` (e.g. `FUNCTION_BLOCK X EXTENDS Y;`).
  // Consume it — otherwise collectVarSections stops at the `;`, drops every local from the symbol table,
  // and every member reference false-positives as unresolved-identifier. (Same class as the METHOD/FUNCTION
  // trailing-`;` fix.)
  c.eatPunct(";")

  const varSections = collectVarSections(c)
  const body = collectBodyUntil(c, "END_FUNCTION_BLOCK", "function block", "pou-or-accessor")

  return {
    kind: "function_block",
    name,
    ...(accessModifier !== undefined ? { accessModifier } : {}),
    ...(extendsName !== undefined ? { extends: extendsName } : {}),
    ...(extendsExtra !== undefined ? { extendsExtra } : {}),
    ...(implementsList !== undefined ? { implements: implementsList } : {}),
    ...(isFinal ? { final: true } : {}),
    ...(isAbstract ? { abstract: true } : {}),
    varSections,
    body,
    span: joinSpans(start.span, body.span),
  }
}
