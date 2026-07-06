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
    const required = REQUIRED[method]
    if (required.length === 0) continue // FB_ReInit — nothing required

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
