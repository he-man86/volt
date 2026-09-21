/**
 * wstring-escape (types/). A WSTRING's hex escape is FOUR hex digits, and both compilers refuse anything else at
 * the PARSER — `"$41"` is not a short `$41`, it is a malformed escape that ends the literal.
 *
 * Measured 2026-09-21 on both live IDEs, by asking the width rather than assuming it. Four cells refused
 * (`$41`, `$FF`, `$C3$A9`, `$004`) and thirteen compile: `$0041`, `$00FF`, `$00E9`, `$20AC`, `a$0041b`, the
 * five-digit `$00041` (which is four digits and then a `1`), the named escapes `$$` `$"` `$N` `a$Tb`, and both
 * `WSTRING(3)` cells. The plain `"abc"` beside them always compiled, so the literal was never the problem.
 *
 * <p>WHY THE FOUR CELLS WERE NOT ENOUGH ON THEIR OWN. They were recorded long before this and they establish a
 * REFUSAL, not a RULE: "a WSTRING takes no `$` escape" and "a WSTRING escape is four digits" both fit all four,
 * and they are different rules that disagree about every valid string. The thirteen new cells are what separates
 * them — and the lexer said as much in a comment, "we don't try to enforce the difference at lex time".</p>
 *
 * <p>THE ECHO IS THE VENDORS' ONE DIFFERENCE, and it is a difference in how far each one LEXED. CODESYS reads the
 * whole literal and then rejects it, so it quotes `"$C3$A9"` entire. TwinCAT stops at the offending escape and
 * quotes `"$C3` — everything up to the end of the too-short hex run, opening quote included.</p>
 *
 * <p>NOT COVERED, and left visible rather than guessed: TwinCAT then loses the REST of the VAR block (its
 * recording adds "'END_VAR' expected instead of ''" and two errors about the later variable, which is the same
 * abandoned-block cascade `var_non_retain` shows). That is a recovery rule of its own and wants its own
 * measurement, not an extrapolation from here.</p>
 */
import { renderTypeExpr } from "../../../syntax/index.js"
import { forEachDecl } from "../../../symbols/index.js"
import type { CheckContext } from "../../diagnostics.js"
import { SOURCE, type DiagnosticItem } from "../../diagnostic-item.js"

const HEX = /[0-9a-fA-F]/

/**
 * Where a WSTRING literal's first malformed hex escape ENDS, or `undefined` when every escape is well formed.
 * A `$` followed by a hex digit opens a hex escape and must carry four; `$$`, `$"`, `$N` and the rest are named
 * escapes and are not this check's business.
 */
function firstBadEscapeEnd(text: string): number | undefined {
  for (let i = 1; i < text.length; i++) {
    if (text[i] !== "$") continue
    const first = text[i + 1]
    if (first === undefined || !HEX.test(first)) {
      i += 1 // a named escape consumes its one character, `$$` included
      continue
    }
    let n = 0
    while (n < 4 && HEX.test(text[i + 1 + n] ?? "")) n += 1
    if (n < 4) return i + 1 + n
    i += 4
  }
  return undefined
}

export function checkWstringEscape(ctx: CheckContext, out: DiagnosticItem[]): void {
  const decls = [...forEachDecl(ctx.parseResult, ctx.project)].map(({ decl }) => decl)
  for (const token of ctx.tokens()) {
    if (token.kind !== "wstring_lit") continue
    const bad = firstBadEscapeEnd(token.text)
    if (bad === undefined) continue
    // CODESYS lexed the whole literal before rejecting it; TwinCAT stopped at the escape
    const echo = ctx.config.vendor === "twincat" ? token.text.slice(0, bad) : token.text
    const messages = [ctx.messages.semicolonExpectedInsteadOf(echo), ctx.messages.expressionExpectedInsteadOf(echo)]
    // As a declaration's initializer the initial value then fails on its own, with the compiler's placeholder for
    // the expression it could not build — the same shape a sub-millisecond TIME literal produces.
    const owner = decls.find((d) => d.init !== undefined && d.init.span.start <= token.span.start && token.span.end <= d.init.span.end)
    if (owner !== undefined) messages.push(ctx.messages.cannotConvert("Unknown type: '!!!'ERROR'!!!'", renderTypeExpr(owner.type)))
    for (const message of messages) out.push({ severity: "error", span: token.span, source: SOURCE, code: "wstring-escape", message })
  }
}
