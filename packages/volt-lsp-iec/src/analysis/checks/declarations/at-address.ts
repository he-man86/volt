/**
 * at-address (C0030 · declarations/). An `AT` clause the compiler did not take:
 *
 *   - an operand that is NO ADDRESS (`i AT ABC : INT;`, `AT 16#10`, `AT 'x'`, `AT :`, `AT %IW*`) is the PARSER's refusal,
 *     "Direct address expected after AT instead of ABC" (`parse/declarations` `refuseAtOperand`, frontend-conformance
 *     2.3.3). The declaration is LOST — the compiler never saw it, and answers `Identifier 'misplaced' not defined` at
 *     every use (`cc5_at_address_not_direct`, `decl_at_*`): the binder binds none of it (`VarDecl.atRefused`), so the
 *     uses are the unresolved-identifier check's, as for any name nothing declares.
 *   - an address whose SHAPE both vendors refuse but keep (`syntax/literal/address`: `%I0.0`, `%MW2.5` — measured
 *     2026-10-01) is named here, and the declaration stands.
 */
import { addressShape, isTrivia } from "../../../frontend/syntax/index.js"
import type { CheckContext } from "../../diagnostics.js"
import { forEachDecl } from "../../../frontend/symbols/index.js"
import { SOURCE, type DiagnosticItem } from "../../diagnostic-item.js"

export function checkAtAddress(ctx: CheckContext, out: DiagnosticItem[]): void {
  for (const { decl } of forEachDecl(ctx.parseResult, ctx.project)) {
    const op = decl.at?.tokens.find((t) => !isTrivia(t.kind))
    if (decl.atRefused === true || op?.kind !== "address_lit") continue
    // a MALFORMED address is named and the declaration stands (`lit_address_unsized*`, `lit_address_bit_*`,
    // `lit_address_*_segment*`, both vendors 2026-10-01)
    const shape = addressShape(op.text)
    if (shape.kind === "malformed")
      out.push({ severity: "error", span: op.span, source: SOURCE, code: "at-address", message: ctx.messages.directAddressMalformed(shape.echo) })
  }
}
