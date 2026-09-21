/**
 * dynamic-creation (declarations/). `__NEW(T)` where T is a FUNCTION BLOCK or a STRUCT needs that type to carry
 * `{attribute 'enable_dynamic_creation'}`:
 *
 *   A function block or structure needs the pragma '{attribute 'enable_dynamic_creation'}' to be created with __NEW
 *
 * Measured on SP21 with the pragma as the ONLY variable (`newdel_without_pragma` errors, `newdel_with_pragma` does
 * not) and with two things that looked like variables and are not: an FB that also has a METHOD
 * (`newdel_with_pragma_has_method`) and a `__NEW` written INSIDE a method (`newdel_in_method_with_pragma`) are both
 * clean. `__NEW(INT)` is clean too — an elementary type carries no pragma and needs none (`newdel_elementary`).
 *
 * SAME FILE ONLY, and that is a real limit, not a conservative one: the pragma lives in the lexer's tokens, so it
 * can only be read from a source this check HOLDS. A project-wide attribute index would close it — the binder does
 * this for `qualified_only` — and until one exists, `__NEW` of an FB declared in another file is unchecked.
 *
 * BOTH VENDORS, measured 2026-09-20: TwinCAT has the rule and words it differently — "A Functionblock or
 * Structure needs the ATTRIBUTE …" where CODESYS says "A function block or structure needs the PRAGMA …"
 * (`newdel_without_pragma`, `newdel_with_pragma`). It was CODESYS-only on the grounds that TwinCAT's opt-in was
 * "documented, not measured"; it is measured now, and the wording is data in `messages.ts` like every other.
 */
import { forEachExpr } from "../../../symbols/index.js"
import { unitAttributes, type TopLevel } from "../../../syntax/index.js"
import type { CheckContext } from "../../diagnostics.js"
import { SOURCE, type DiagnosticItem } from "../../diagnostic-item.js"

const ATTRIBUTE = "enable_dynamic_creation"

export function checkDynamicCreation(ctx: CheckContext, out: DiagnosticItem[]): void {

  let attributes: Map<TopLevel, Set<string>> | undefined
  forEachExpr(ctx.parseResult, ctx.project, (e) => {
    if (e.kind !== "call" || e.callee.kind !== "ident_expr" || e.callee.name.toUpperCase() !== "__NEW") return
    const arg = e.args[0]?.value
    if (arg?.kind !== "ident_expr") return
    const target = ctx.parseResult.units.find(
      (u) => (u.kind === "function_block" || u.kind === "type_decl") && "name" in u && u.name.text.toLowerCase() === arg.name.toLowerCase(),
    )
    if (target === undefined) return // declared elsewhere — its pragma is not in this source
    attributes ??= unitAttributes(ctx.parseResult, ctx.source)
    if (attributes.get(target)?.has(ATTRIBUTE) === true) return
    out.push({
      severity: "error",
      span: arg.span,
      source: SOURCE,
      code: "dynamic-creation-pragma",
      message: ctx.messages.dynamicCreationPragma(),
    })
  })
}
