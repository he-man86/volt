/**
 * `FUNCTION_BLOCK [modifiers] Name [EXTENDS Base] [IMPLEMENTS I1, I2] [;]
 *  <var-sections>
 *  <body>
 *  END_FUNCTION_BLOCK`
 *
 * The modifiers are kept in order as written (`INTERNAL FINAL`); an access modifier stands only first — written after
 * another modifier, both vendors declare no FB at all (`headerRefused`). `EXTENDS` names one base and `IMPLEMENTS` a
 * list, each name possibly qualified (`Standard.TON`); IMPLEMENTS before EXTENDS is no header (`unit_fb_implements_
 * before_extends`: "Unexpected token 'EXTENDS' found", the body parser's).
 */
import type { FunctionBlock, Identifier } from "../../ast/nodes.js"
import type { Cursor } from "../cursor.js"
import { collectBodyUntil } from "../body.js"
import { FB_MODIFIERS } from "../../lex/vocabulary.js"
import { joinSpans } from "../../span.js"
import { identFromToken, readHeaderName, readModifiers, readNameList, refusedAccessModifier } from "../names.js"
import { collectVarSections } from "../declarations.js"
import { readImplements, refuseLateClauses } from "./header.js"

export function parseFunctionBlock(c: Cursor): FunctionBlock | undefined {
  const start = c.expectKeyword("FUNCTION_BLOCK")
  if (start === undefined) return undefined

  // A modifier keyword is a modifier only when a name (or another modifier) follows it; otherwise it IS the name
  // (`FUNCTION_BLOCK PUBLIC Final`). The `IMPLEMENTATION` line is an identifier token but never a name — it ends the
  // declaration, and an FB with no VAR puts it straight under the header — so it does not count as one. Eating
  // greedily named such an FB `IMPLEMENTATION` (the method header's twin, `parseMethod`).
  const written = readModifiers(
    c,
    FB_MODIFIERS,
    (after) =>
      (after.kind === "identifier" && !c.opensImplementationLine(1)) ||
      (after.kind === "keyword" && after.keyword !== undefined && FB_MODIFIERS.includes(after.keyword)),
  )
  // An access modifier after another one leaves no FB declared, and no message about it on either vendor.
  const refused = refusedAccessModifier(written)
  const modifiers = written.map((m) => m.keyword!)

  // `expectUnitName`, as a method's: a modifier keyword the loop above left is the FB's name.
  const nameTok = c.expectUnitName()
  if (nameTok === undefined) return undefined
  const name = identFromToken(nameTok)

  // Optional EXTENDS X. FBs are single-inheritance, but a stray `EXTENDS A, B` appears in error cases —
  // capture the illegal extra bases (rather than leaving `, B` to corrupt the following var-sections) so a
  // check can emit C0096.
  let extendsName: Identifier | undefined
  let extendsExtra: Identifier[] | undefined
  if (c.eatKeyword("EXTENDS") !== undefined) {
    extendsName = readHeaderName(c)
    const more = readNameList(c, () => readHeaderName(c))
    if (more.length > 0) extendsExtra = more
  }

  // Optional IMPLEMENTS X, Y, Z
  const implementsList = readImplements(c)
  // …and nothing after it: `IMPLEMENTS I EXTENDS B` is no header (`unit_fb_implements_before_extends`)
  refuseLateClauses(c)

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
    modifiers,
    ...(refused !== undefined ? { headerRefused: true as const } : {}),
    ...(extendsName !== undefined ? { extends: extendsName } : {}),
    ...(extendsExtra !== undefined ? { extendsExtra } : {}),
    ...(implementsList !== undefined ? { implements: implementsList } : {}),
    varSections,
    body,
    span: joinSpans(start.span, body.span),
  }
}
