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
 *   - only a bare `named_type` — an `ARRAY[1..3] OF FB_X` is a real instantiation and unmeasured;
 *   - only where NO arguments were written at all — a wrong COUNT is a different (unmeasured) message;
 *   - never a VAR_IN_OUT or VAR_EXTERNAL, which bind to somebody else's instance and construct nothing;
 *   - never a library FB (no scope to read `FB_Init` from), and never one whose `FB_Init` is inherited — the
 *     measured case declares it on the FB itself, and a base's is a separate question.
 *
 * BOTH VENDORS, measured 2026-09-20 (`fb_init_argument_left_out`): TwinCAT reports it and STOPS at the name —
 * "No matching FB_init method found for instantiation of X", with no input count and no suggested syntax.
 */
import { renderTypeExpr, varInputParams, type Method } from "../../../syntax/index.js"
import { forEachDecl, isLibrarySymbol, lookupLocal } from "../../../symbols/index.js"
import { resolveTypeExpr } from "../../../types/index.js"
import type { CheckContext } from "../../diagnostics.js"
import { SOURCE, type DiagnosticItem } from "../../diagnostic-item.js"

/** The two the compiler passes itself — everything after them is the caller's to supply. */
const IMPLICIT_INPUTS = 2

export function checkFbInitInstantiation(ctx: CheckContext, out: DiagnosticItem[]): void {

  for (const { section, decl } of forEachDecl(ctx.parseResult, ctx.project)) {
    if (section.sectionKind === "VAR_IN_OUT" || section.sectionKind === "VAR_EXTERNAL") continue
    if (decl.type.kind !== "named_type" || decl.type.initArgs !== undefined) continue
    const type = resolveTypeExpr(decl.type, ctx.project)
    if (type.kind !== "function_block" || type.scope === undefined) continue
    const init = lookupLocal(type.scope, "FB_Init").find((s) => s.kind === "method")
    if (init === undefined || isLibrarySymbol(init)) continue
    const extra = varInputParams((init.ast as Method).varSections).slice(IMPLICIT_INPUTS)
    if (extra.length === 0) continue
    const types = extra.map((p) => renderTypeExpr(p.type)).join(", ")
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
