/**
 * time-literal-unit (types/). A TIME literal has no microsecond or nanosecond unit in CODESYS: `T#1500US` does not
 * compile. CODESYS ends the literal at the unit and rejects what is left of it — in a declaration and in a body alike it
 * reports `';' expected instead of 'T#1500'` and `Expression expected instead of 'T#1500'` (conformance
 * `cc_time_microsecond_literal*`, `cc_time_nanosecond_literal`, `cc_time_seconds_then_microseconds`). The lexer ends the
 * literal there too; this reports those two messages. The rest of the cascade — an unknown-type conversion in a
 * declaration; `Unexpected token`, `';' expected instead of 'US'` and a no-effect warning in a body — is left to the
 * parser or not mirrored, so the LSP stays a subset.
 *
 * Why nothing caught it (gap 7): the lexer took `us`/`ns` for every duration literal, as LTIME needs; no fixture used a
 * sub-millisecond TIME literal; and no compiling project contains one.
 *
 * CODESYS-only: TwinCAT is unmeasured, and a guess there would be a new false positive.
 */
import { renderTypeExpr } from "../../../types/index.js"
import type { CheckContext } from "../../diagnostics.js"
import { forEachDecl } from "../../../symbols/index.js"
import { SOURCE, type DiagnosticItem } from "../_shared.js"

const SUB_MILLISECOND = /^(us|ns)$/i

export function checkTimeLiteralUnit(ctx: CheckContext, out: DiagnosticItem[]): void {
  if (ctx.config.vendor !== "codesys") return
  const decls = [...forEachDecl(ctx.parseResult, ctx.project)].map(({ decl }) => decl)
  const tokens = ctx.tokens()
  for (let i = 0; i + 1 < tokens.length; i++) {
    const literal = tokens[i]!
    const unit = tokens[i + 1]!
    // adjacent, so `T#1500 US` (a separate identifier) is not this
    const cut = literal.kind === "time_lit" && !/^L/i.test(literal.text) && unit.span.start === literal.span.end
    if (!cut || !SUB_MILLISECOND.test(unit.text)) continue
    const messages = [ctx.messages.semicolonExpectedInsteadOf(literal.text), ctx.messages.expressionExpectedInsteadOf(literal.text)]
    // As a declaration's initializer, CODESYS then fails the initial value itself: "Cannot convert type 'Unknown type:
    // '!!!'ERROR'!!!'' to type 'TIME'" (`cc_time_microsecond_literal`). A body has a different tail, not mirrored.
    const owner = decls.find((d) => d.init !== undefined && d.init.span.start <= literal.span.start && literal.span.end <= d.init.span.end)
    if (owner !== undefined) messages.push(ctx.messages.cannotConvert("Unknown type: '!!!'ERROR'!!!'", renderTypeExpr(owner.type)))
    for (const message of messages) out.push({ severity: "error", span: literal.span, source: SOURCE, code: "time-literal-unit", message })
  }
}
