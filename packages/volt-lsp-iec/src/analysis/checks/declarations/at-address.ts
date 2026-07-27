/**
 * at-address (C0030 · declarations/). An `AT` clause whose operand is not a direct address — `i AT ABC : INT;`
 * instead of `i AT %IB8 : INT;`. CODESYS: "Direct address expected after AT instead of ABC". Verified live against
 * CODESYS 3.5.21 (the doc wording had drifted — no quotes in the current message).
 *
 * Zero-FP: a valid AT operand is a direct-address literal (`%IB8`, `%IX0.0`, `%I*`) — the lexer tags those
 * `address_lit`. We flag ONLY when the operand's first meaningful token is an `identifier` (`ABC`), which an
 * address can never be. Exotic/placeholder addresses stay `address_lit`, so real memory-mapped vars never fire.
 */
import { isTrivia } from "../../../syntax/index.js"
import type { CheckContext } from "../../diagnostics.js"
import { SOURCE, forEachDecl, type DiagnosticItem } from "../_shared.js"

export function checkAtAddress(ctx: CheckContext, out: DiagnosticItem[]): void {
  for (const { decl } of forEachDecl(ctx.parseResult, ctx.project)) {
    const op = decl.at?.tokens.find((t) => !isTrivia(t.kind))
    if (op === undefined || op.kind !== "identifier") continue
    out.push({
      severity: "error",
      span: op.span,
      source: SOURCE,
      code: "at-address",
      message: ctx.messages.directAddressExpectedAt(op.text),
    })
  }
}
