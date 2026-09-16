/**
 * time-literal-unit (types/). A TIME literal has no microsecond or nanosecond unit in CODESYS: `T#1500US` does not
 * compile. CODESYS ends the literal at the unit and rejects what is left of it — in a declaration and in a body alike it
 * reports `';' expected instead of 'T#1500'` and `Expression expected instead of 'T#1500'` (conformance
 * `cc_time_microsecond_literal*`, `cc_time_nanosecond_literal`, `cc_time_seconds_then_microseconds`). The lexer ends the
 * literal there too. The rest of the cascade differs by position: a DECLARATION then fails the initial value itself,
 * and a BODY re-reads what is left of the literal as a statement of its own — so `t1 := T#5NS;` ends with the unit
 * standing alone as `NS;`, which has no effect. (`';' expected instead of 'NS'` comes from the parser.)
 *
 * Why nothing caught it (gap 7): the lexer took `us`/`ns` for every duration literal, as LTIME needs; no fixture used a
 * sub-millisecond TIME literal; and no compiling project contains one.
 *
 * CODESYS-only: TwinCAT is unmeasured, and a guess there would be a new false positive.
 */
import { renderTypeExpr } from "../../../syntax/index.js"
import type { CheckContext } from "../../diagnostics.js"
import { forEachDecl } from "../../../symbols/index.js"
import { SOURCE, type DiagnosticItem } from "../../diagnostic-item.js"

const SUB_MILLISECOND = /^(us|ns)$/i
const LINE_END_AFTER = /^[^\S\r\n]*(\r?\n)/

/** The orphaned unit as the statement it becomes — through its `;` and the line break that ends it, as the IDE quotes it. */
function leftoverStatement(source: string, from: number): string | undefined {
  const rest = source.slice(from)
  const end = rest.indexOf(";")
  if (end < 0) return undefined
  const br = LINE_END_AFTER.exec(rest.slice(end + 1))
  return rest.slice(0, end + 1) + (br?.[1] ?? "")
}

export function checkTimeLiteralUnit(ctx: CheckContext, out: DiagnosticItem[]): void {
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
    // '!!!'ERROR'!!!'' to type 'TIME'" (`cc_time_microsecond_literal`).
    const owner = decls.find((d) => d.init !== undefined && d.init.span.start <= literal.span.start && literal.span.end <= d.init.span.end)
    if (owner !== undefined) messages.push(ctx.messages.cannotConvert("Unknown type: '!!!'ERROR'!!!'", renderTypeExpr(owner.type)))
    else messages.push(ctx.messages.unexpectedToken(literal.text))
    for (const message of messages) out.push({ severity: "error", span: literal.span, source: SOURCE, code: "time-literal-unit", message })
    if (owner !== undefined) continue
    // in a BODY, what is left of the literal stands alone as a statement — `NS;` — and does nothing
    const statement = leftoverStatement(ctx.source, unit.span.start)
    if (statement !== undefined)
      out.push({ severity: "warning", span: unit.span, source: SOURCE, code: "time-literal-unit", message: ctx.messages.codeHasNoEffect(statement) })
  }
}
