/**
 * `ACTION Name <body> END_ACTION`
 *
 * Actions are the simplest unit — no return type, no modifiers, no
 * VAR sections. The body is captured opaquely up to END_ACTION.
 */
import type { Action } from "../../ast/nodes.js"
import type { Cursor } from "../cursor.js"
import { collectBodyUntil } from "../body.js"
import { joinSpans } from "../../span.js"
import { identFromToken } from "../names.js"

export function parseAction(c: Cursor): Action | undefined {
  const start = c.expectKeyword("ACTION")
  if (start === undefined) return undefined
  const nameTok = c.expectIdent()
  if (nameTok === undefined) return undefined
  const name = identFromToken(nameTok)
  const body = collectBodyUntil(c, "END_ACTION", "action", "member")
  return {
    kind: "action",
    name,
    body,
    span: joinSpans(start.span, body.span),
  }
}
