/**
 * fb-lifecycle-signature (D.2 · oop/). A method named for a lifecycle hook (FB_Init/FB_Exit/FB_ReInit)
 * must declare the required VAR_INPUT params, in order. Mirrors the compilers: they error when a
 * required param is missing but permit deviating return types / extra params. One canned message per
 * method (per-vendor wording via `messages.lifecycle`), flagged once.
 *
 * ponytail: the required-param table is inlined here — it moves to `reference/lifecycle` when Layer F lands.
 */
import { varInputParams } from "../../../syntax/index.js"
import type { LifecycleMethod } from "../../messages.js"
import type { CheckContext } from "../../diagnostics.js"
import { SOURCE, type DiagnosticItem } from "../_shared.js"

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

    const inputs = varInputParams(unit.varSections).map((p) => p.name.text)
    const violated = required.some((name, i) => (inputs[i] ?? "").toLowerCase() !== name.toLowerCase())
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
