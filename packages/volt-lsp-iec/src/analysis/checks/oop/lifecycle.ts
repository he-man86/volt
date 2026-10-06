/**
 * fb-lifecycle-signature (D.2 · oop/). A method named for a lifecycle hook (FB_Init/FB_Exit/FB_ReInit)
 * must declare the required VAR_INPUT params, in order, each a BOOL. Mirrors the compilers: they error when a
 * required param is missing or of another type, and permit deviating return types and FB_Init's extra params —
 * not FB_Exit's, which takes its one input alone (analysis-conformance 3.7). One canned message per
 * method (per-vendor wording via `messages.lifecycle`), flagged once.
 *
 * ponytail: the required-param table is inlined here, its one reader; move it to `reference/` if a second appears.
 */
import { varInputParams, type TypeExpr } from "../../../frontend/syntax/index.js"
import type { LifecycleMethod } from "../../messages.js"
import type { CheckContext } from "../../pipeline/context.js"
import { SOURCE, type DiagnosticItem } from "../../shared/diagnostic-item.js"

const REQUIRED: Record<LifecycleMethod, readonly string[]> = {
  FB_Init: ["bInitRetains", "bInCopyCode"],
  FB_Exit: ["bInCopyCode"],
  FB_ReInit: [],
}

function lifecycleOf(name: string): LifecycleMethod | undefined {
  const u = name.toUpperCase()
  if (u === "FB_INIT") return "FB_Init"
  if (u === "FB_EXIT") return "FB_Exit"
  if (u === "FB_REINIT") return "FB_ReInit"
  return undefined
}

export function checkLifecycleSignatures(ctx: CheckContext, out: DiagnosticItem[]): void {
  for (const unit of ctx.parseResult.units) {
    if (unit.kind !== "method") continue
    const method = lifecycleOf(unit.name.text)
    if (method === undefined) continue

    // C0566 — FB_ReInit is the inverse of the others: it must have NO inputs and return BOOL (else it won't be
    // auto-called). Flag when it has any VAR_INPUT param or a non-BOOL / missing return type. CODESYS-only:
    // live /build + the recorded conformance oracle both confirm TwinCAT silently accepts a param'd FB_ReInit.
    if (method === "FB_ReInit") {
      if (ctx.config.vendor !== "codesys") continue
      const rt = unit.returnType
      const returnsBool = rt?.kind === "named_type" && rt.name.text.toUpperCase() === "BOOL"
      if (varInputParams(unit.varSections).length > 0 || !returnsBool)
        out.push({
          severity: "warning",
          span: unit.name.span,
          source: SOURCE,
          code: "fb-reinit-shape",
          message: ctx.messages.fbReInitShape(),
        })
      continue
    }

    const required = REQUIRED[method]
    if (required.length === 0) continue

    // each required input in its slot, of type BOOL (an INT `bInitRetains` is the same refusal); FB_Exit takes its one
    // input ALONE, where FB_Init takes extra inputs after the two (`oopb_fb_init_input_wrong_type`,
    // `oopb_fb_exit_extra_input`, both vendors 2026-10-06)
    const inputs = varInputParams(unit.varSections)
    const isBool = (t: TypeExpr | undefined) => t?.kind === "named_type" && t.name.text.toUpperCase() === "BOOL"
    const violated =
      required.some((name, i) => (inputs[i]?.name.text ?? "").toLowerCase() !== name.toLowerCase() || !isBool(inputs[i]?.type)) ||
      (method === "FB_Exit" && inputs.length > required.length)
    if (violated) {
      out.push({
        severity: "error",
        span: unit.name.span,
        source: SOURCE,
        code: "fb-lifecycle-signature",
        message: ctx.messages.lifecycle(method),
      })
    }
  }
}
