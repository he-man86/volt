/**
 * `PROGRAM Name <var-sections> <body> END_PROGRAM`
 *
 * No modifiers, no extends/implements — programs are top-level
 * entry points and don't participate in the FB inheritance graph. The header may end in `;` (`PROGRAM P;`, both
 * vendors build it: `unit_program_trailing_semicolon`).
 */
import type { Program } from "../../ast/nodes.js"
import type { Cursor } from "../cursor.js"
import { parseOptionalReturnType } from "./header.js"
import { collectBodyUntil } from "../body.js"
import { joinSpans } from "../../span.js"
import { identFromToken } from "../names.js"
import { collectVarSections } from "../declarations.js"

export function parseProgram(c: Cursor): Program | undefined {
  const start = c.expectKeyword("PROGRAM")
  if (start === undefined) return undefined
  const nameTok = c.expectIdent()
  if (nameTok === undefined) return undefined
  const name = identFromToken(nameTok)

  // A return type on a PROGRAM (`PROGRAM P : BOOL`) is illegal — capture it so a check can emit C0182
  // (rather than letting the `: <type>` fall into the body collector); then the header's optional `;`.
  const returnType = parseOptionalReturnType(c)

  const varSections = collectVarSections(c)
  const body = collectBodyUntil(c, "END_PROGRAM", "program", "pou-or-accessor")

  return {
    kind: "program",
    name,
    ...returnType,
    varSections,
    body,
    span: joinSpans(start.span, body.span),
  }
}
