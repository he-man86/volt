/**
 * fb-init-instantiation (oop/). An FB whose `FB_Init` takes MORE than the two standard inputs cannot be
 * instantiated bare: the extra inputs are supplied at the DECLARATION, `plain : FB_X(3);`, and leaving them out is
 * a compile error. Measured on SP21 (`fb_init_argument_left_out`):
 *
 *   No matching 'FB_Init' method found for instantiation of FB_LANG_init_leftout. Specified 'FB_Init' method
 *   requires exactly 1 inputs. Check syntax 'plain : FB_LANG_init_leftout(INT)'
 *
 * — the count and the `Check syntax` hint both name the EXTRA inputs only, not the `bInitRetains`/`bInCopyCode`
 * pair the compiler supplies itself.
 *
 * Conservative, because an instantiation is not the only thing a declaration of an FB type can be:
 *   - a bare `named_type` with no arguments, or with a COUNT other than the extra inputs' — the same message
 *     (`oopa_fb_init_two_arguments`, both vendors 2026-10-06); an `ARRAY[1..2] OF FB_X` with no initializer counts its
 *     FB_Init initializers against its elements, "The number of 'FB_Init' initializers (0) does not match the number of
 *     array elements (2)" (`oopa_fb_init_array_left_out`, an FB's VAR) — counted in an FB's or a PROGRAM's VAR only; an
 *     array WITH initializers, or in another unit or section, is unmeasured;
 *   - never a VAR_IN_OUT or VAR_EXTERNAL, which bind to somebody else's instance and construct nothing;
 *   - never a library FB (no scope to read `FB_Init` from), and never one whose `FB_Init` is inherited — the
 *     measured case declares it on the FB itself, and a base's is a separate question.
 *
 * BOTH VENDORS, measured 2026-09-20 (`fb_init_argument_left_out`): TwinCAT reports it and STOPS at the name —
 * "No matching FB_init method found for instantiation of X", with no input count and no suggested syntax.
 */
import { compilerTypeText, varInputParams, type Method } from "../../../frontend/syntax/index.js"
import { forEachDecl, isLibrarySymbol, lookupLocal } from "../../../frontend/symbols/index.js"
import { resolveTypeExpr, type Type } from "../../../frontend/types/index.js"
import type { CheckContext } from "../../pipeline/context.js"
import { SOURCE, type DiagnosticItem } from "../../shared/diagnostic-item.js"

/** The two the compiler passes itself — everything after them is the caller's to supply. */
const IMPLICIT_INPUTS = 2

export function checkFbInitInstantiation(ctx: CheckContext, out: DiagnosticItem[]): void {
  for (const { unit, section, decl } of forEachDecl(ctx.parseResult, ctx.project)) {
    if (section.sectionKind === "VAR_IN_OUT" || section.sectionKind === "VAR_EXTERNAL") continue
    // an ARRAY of such an FB, with no initializer: the elements' FB_Init initializers are counted (`oopa_fb_init_array_left_out`).
    // `ARRAY[1..3] OF FB_X(a := 1)` gives every element its arguments (pro2193 builds 20 such arrays) — no count then.
    // Measured in an FB's VAR (and a PROGRAM's, its sibling); another unit's or section's array is not asked.
    if (decl.type.kind === "array_type") {
      if (decl.init !== undefined || section.sectionKind !== "VAR" || (unit.kind !== "function_block" && unit.kind !== "program")) continue
      if (decl.type.element.kind === "named_type" && decl.type.element.initArgs !== undefined) continue
      const array = resolveTypeExpr(decl.type, ctx.project, 0, ctx.project, ctx.uri)
      if (array.kind !== "array" || array.bounds === undefined || array.element.kind !== "function_block") continue
      if (extraInputs(array.element).length === 0) continue
      const elements = array.bounds.reduce((n, b) => n * Number(b.upper - b.lower + 1n), 1)
      for (const name of decl.names)
        out.push({ severity: "error", span: name.span, source: SOURCE, code: "fb-init-argument-missing", message: ctx.messages.fbInitArrayCount(0, elements) })
      continue
    }
    if (decl.type.kind !== "named_type") continue
    const type = resolveTypeExpr(decl.type, ctx.project, 0, ctx.project, ctx.uri)
    if (type.kind !== "function_block") continue
    const extra = extraInputs(type)
    if (extra.length === 0) continue
    // none written, or a COUNT other than the extra inputs' — the same message (`oopa_fb_init_two_arguments`, both vendors)
    if (decl.type.initArgs !== undefined && decl.type.initArgs.length === extra.length) continue
    const types = extra.map((p) => compilerTypeText(p.type)).join(", ")
    for (const name of decl.names)
      out.push({
        severity: "error",
        span: name.span,
        source: SOURCE,
        code: "fb-init-argument-missing",
        message: ctx.messages.fbInitInstantiation(type.name, extra.length, `${name.text} : ${type.name}(${types})`),
      })
  }
}

/** The inputs a project FB's own FB_Init takes beyond the two the compiler passes itself — none for a library FB (no
 *  scope to read it from) or one whose FB_Init is inherited (unmeasured). */
function extraInputs(type: Type): ReturnType<typeof varInputParams> {
  if (type.kind !== "function_block" || type.scope === undefined) return []
  const init = lookupLocal(type.scope, "FB_Init").find((s) => s.kind === "method")
  if (init === undefined || isLibrarySymbol(init)) return []
  return varInputParams((init.ast as Method).varSections).slice(IMPLICIT_INPUTS)
}
