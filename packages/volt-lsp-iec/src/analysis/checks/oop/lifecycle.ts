/**
 * fb-lifecycle-signature (D.2 · oop/). A method named for a lifecycle hook (FB_Init/FB_Exit/FB_ReInit)
 * must declare the required VAR_INPUT params, in order, each a BOOL. Mirrors the compilers: they error when a
 * required param is missing or of another type, and permit deviating return types and FB_Init's extra params —
 * not FB_Exit's, which takes its one input alone (analysis-conformance 3.7). One canned message per
 * method (per-vendor wording via `messages.lifecycle`), flagged once.
 *
 * ponytail: the required-param table is inlined here, its one reader; move it to `reference/` if a second appears.
 */
import { varInputParams, type Method, type TypeExpr } from "../../../frontend/syntax/index.js"
import type { LifecycleMethod } from "../../messages/index.js"
import type { CheckContext } from "../../pipeline/context.js"
import { SOURCE, withFixes, type DiagnosticItem, type Fix, type FixEdit } from "../../shared/diagnostic-item.js"
import { fixOf, insertText, lineBreakOf } from "../../shared/fixes.js"

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
      out.push(
        withFixes(
          { severity: "error", span: unit.name.span, source: SOURCE, code: "fb-lifecycle-signature", message: ctx.messages.lifecycle(method) },
          [addInputsFix(ctx, unit, required)],
        ),
      )
    }
  }
}

/**
 * C0119's fix (design.md §4 F8): "Add the input(s) '<name> : BOOL'" — each required input the method's one VAR_INPUT
 * section lacks, in its slot: before the next required one it has, else at the section's end (`qf_c0119_init`, `_exit`,
 * `_init_both`, `_init_retains`). Only where every input it has IS a required one, a BOOL, in order — any other input is
 * one the fix would have to move or retype, which is not the one meaning a `preferred` fix needs.
 */
function addInputsFix(ctx: CheckContext, unit: Method, required: readonly string[]): Fix | undefined {
  const sections = unit.varSections.filter((s) => s.sectionKind === "VAR_INPUT")
  if (sections.length !== 1) return undefined
  const section = sections[0]!
  const decls = section.decls.flatMap((d) => d.names.map((n) => ({ name: n, type: d.type, decl: d })))
  const isBool = (t: TypeExpr) => t.kind === "named_type" && t.name.text.toUpperCase() === "BOOL"
  let r = 0
  for (const d of decls) {
    while (r < required.length && required[r]!.toLowerCase() !== d.name.text.toLowerCase()) r++
    if (r === required.length || !isBool(d.type) || d.decl.names.length !== 1 || d.decl.init !== undefined) return undefined
    r++
  }
  const br = lineBreakOf(ctx.source)
  const lineStart = (offset: number): number | undefined => {
    let i = offset
    while (i > 0 && (ctx.source[i - 1] === " " || ctx.source[i - 1] === "\t")) i--
    return i === 0 || ctx.source[i - 1] === "\n" ? i : undefined
  }
  const endVar = section.span.end - "END_VAR".length
  if (ctx.source.slice(endVar, section.span.end).toUpperCase() !== "END_VAR") return undefined
  const at = new Map<number, string[]>()
  const missing: string[] = []
  for (const name of required) {
    if (decls.some((d) => d.name.text.toLowerCase() === name.toLowerCase())) continue
    const next = required.slice(required.indexOf(name) + 1).map((n) => decls.find((d) => d.name.text.toLowerCase() === n.toLowerCase())).find((d) => d !== undefined)
    const offset = lineStart(next === undefined ? endVar : next.decl.span.start)
    if (offset === undefined) return undefined
    at.set(offset, [...(at.get(offset) ?? []), `\t${name} : BOOL;${br}`])
    missing.push(name)
  }
  if (missing.length === 0) return undefined
  const edits: FixEdit[] = [...at].map(([offset, lines]) => insertText(ctx.source, offset, lines.join("")))
  const title = missing.length === 1 ? `Add the input '${missing[0]} : BOOL'` : `Add the inputs '${missing.map((n) => `${n} : BOOL`).join("; ")}'`
  return fixOf(title, edits, true)
}
