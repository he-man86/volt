/**
 * at-address (C0030 · declarations/). An `AT` clause whose operand is not a direct address — `i AT ABC : INT;`
 * instead of `i AT %IB8 : INT;`. CODESYS: "Direct address expected after AT instead of ABC". Verified live against
 * CODESYS 3.5.21 (the doc wording had drifted — no quotes in the current message).
 *
 * Zero-FP: a valid AT operand is a direct-address literal (`%IB8`, `%IX0.0`, `%I*`) — the lexer tags those
 * `address_lit`. We flag an operand that is an `identifier` (`ABC`), which an address can never be, and an address
 * whose SHAPE both vendors refuse (`syntax/literal/address`: `%IW*`, `%I0.0`, `%MW2.5` — measured 2026-10-01).
 *
 * The declaration is LOST when this fires — the compiler never saw it, and answers `Identifier 'misplaced' not
 * defined` at every use (conformance `cc5_at_address_not_direct`).
 */
import { addressShape, isTrivia } from "../../../frontend/syntax/index.js"
import type { CheckContext } from "../../diagnostics.js"
import { forEachDecl } from "../../../frontend/symbols/index.js"
import { reportLostUses } from "../../lost-declaration.js"
import { SOURCE, type DiagnosticItem } from "../../diagnostic-item.js"

export function checkAtAddress(ctx: CheckContext, out: DiagnosticItem[]): void {
  const lost = new Set<string>()
  for (const { decl } of forEachDecl(ctx.parseResult, ctx.project)) {
    const op = decl.at?.tokens.find((t) => !isTrivia(t.kind))
    if (op === undefined) continue
    const error = (message: string): void => {
      out.push({ severity: "error", span: op.span, source: SOURCE, code: "at-address", message })
    }
    // An ADDRESS is taken by its shape (`syntax/literal/address`): one with a size and no position is no address at
    // all, and the declaration is lost as for a name (`%IW*` lexes `%IW` then `*`; `lit_address_incomplete_sized`,
    // `lit_address_no_position`); a malformed one is named and the declaration stands (`lit_address_unsized*`,
    // `lit_address_bit_*`, `lit_address_*_segment*`, both vendors 2026-10-01).
    // (the no-position refusal itself is the PARSER's, `parse/declarations` `refuseAtOperand`; its lost uses are here)
    const shape = op.kind === "address_lit" ? addressShape(op.text) : undefined
    if (shape?.kind === "malformed") error(ctx.messages.directAddressMalformed(shape.echo))
    if (op.kind === "identifier") error(ctx.messages.directAddressExpectedAt(op.text))
    if (op.kind !== "identifier" && shape?.kind !== "no-position") continue
    for (const name of decl.names) lost.add(name.text.toLowerCase())
  }
  reportLostUses(ctx, out, lost)
}
