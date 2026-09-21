/**
 * system-initializer (declarations/). A `__`-prefixed name the compiler does not know is refused by the PARSER
 * inside a declaration's initializer — not reported as an undefined identifier, the way the same name in a BODY
 * is. Both vendors, identically:
 *
 *   n : DINT := __NO_SUCH_THING;
 *     ';' expected instead of '__NO_SUCH_THING'
 *     Expression expected instead of '__NO_SUCH_THING'
 *     Cannot convert type 'Unknown type: '!!!'ERROR'!!!'' to type 'DINT'
 *
 * <p>MEASURED 2026-09-21, with the two readings held apart. `sysop_position_initializer` showed TwinCAT refusing
 * `here : DINT := __POSITION;` at the parser, and that fits "a `__` name it does not have" and "any name an
 * initializer cannot fold" equally well — different rules that disagree about ordinary code. Four cells separate
 * them: `n : DINT := nope;` is an undefined IDENTIFIER on both vendors (`cc_decl_init_unknown_name`), a sibling
 * variable is accepted outright — an initializer is not a constant-only place (`cc_decl_init_sibling_var`) — and
 * `__NO_SUCH_THING`, which NEITHER vendor has, draws these three on BOTH (`cc_decl_init_dunder_unknown`).</p>
 *
 * <p>So the rule is shared and only its MEMBERSHIP is dialect data: `__POSITION` is CODESYS's, so CODESYS folds
 * it and TwinCAT lands here. `unresolved-identifier` hands the name over rather than calling it undefined,
 * because the compiler never gets that far.</p>
 *
 * <p>Measured for the initializer's LEADING token, which is where every recorded cell has it.</p>
 */
import { renderTypeExpr } from "../../../syntax/index.js"
import { forEachDecl } from "../../../symbols/index.js"
import { refusedSystemNames } from "../../resolution.js"
import type { CheckContext } from "../../diagnostics.js"
import { SOURCE, type DiagnosticItem } from "../../diagnostic-item.js"

export function checkSystemInitializer(ctx: CheckContext, out: DiagnosticItem[]): void {
  for (const { decl, scope } of forEachDecl(ctx.parseResult, ctx.project)) {
    if (decl.init === undefined || decl.init.kind === "aggregate_init") continue
    const refused = refusedSystemNames([decl.init], scope, ctx.project, ctx.references)[0]
    if (refused === undefined) continue
    const error = (message: string): void => {
      out.push({ severity: "error", span: refused.span, source: SOURCE, code: "system-initializer", message })
    }
    error(ctx.messages.semicolonExpectedInsteadOf(refused.name))
    error(ctx.messages.expressionExpectedInsteadOf(refused.name))
    // the initial value is then the compiler's own placeholder for an expression it could not build
    error(ctx.messages.cannotConvert(ctx.messages.unknownType("!!!'ERROR'!!!"), renderTypeExpr(decl.type)))
  }
}
