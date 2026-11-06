/**
 * ONE BOX OF A PLAIN-ST NETWORK BODY (`_plain-st.ts`, the one network check, holds the rest): the call a box is, held as
 * the bridge's reader holds it (`StNetworkReader` `CallBox`, openspec network-language) and refused in its words.
 */
import { type CallExpr } from "../../../frontend/syntax/index.js"
import { type Scope } from "../../../frontend/symbols/index.js"
import { dataOutputs, declaresEn, declaresEno, declaresOut, inferExprType, misleadingBox, networkBox } from "../../../frontend/types/index.js"
import { emit, type DiagnosticItem } from "../../shared/diagnostic-item.js"
import { CODE } from "./_plain-st-wires.js"

export function calleeText(call: CallExpr): string {
  const c = call.callee
  return c.kind === "ident_expr" ? c.name
    : c.kind === "member" ? `${calleeText({ ...call, callee: c.base })}.${c.member.name}`
    : c.kind === "deref" ? `${calleeText({ ...call, callee: c.base })}^`
    : c.kind === "index" ? `${calleeText({ ...call, callee: c.base })}[…]`
    : "?"
}

/**
 * ONE BOX, as the bridge's reader holds it (`StNetworkReader` `CallBox`, network-language rules 4 and 9): the call of its
 * instance (an FB) or its callee, `EN :=` first, the member closing it only where another output than its default flows
 * on, and an output's name carrying its mark only where the callee does not declare that name too.
 */
export function checkBox(call: CallExpr, member: string | undefined, consumed: boolean, scope: Scope, project: Scope, out: DiagnosticItem[]): void {
  const box = networkBox(call, scope, project)
  if (box === undefined) return
  // the call's head, and the callee it names: an FB box's its instance's type
  const head = calleeText(call)
  const fb = box.instance === undefined ? undefined : inferExprType(box.instance, scope, project)
  const type = fb?.kind === "function_block" ? fb.name : head
  const at = call.callee.span
  const signature = box.signature
  for (const m of misleadingBox(box, head, { consumed, member })) emit(out, m.span, CODE, m.message)
  for (const a of box.ambiguous)
    emit(out, a.span, CODE, `${a.param!.name} => on the call ${head}: an output named like a marked output of the same box is refused, ` +
      (signature === undefined ? `no declaration in reach states whether ${type} declares it or the output it would mark` : `${type} declares both it and the output it would mark`))
  if (signature === undefined && (box.instance !== undefined || call.callee.kind === "ident_expr")) {
    // a callee no declaration in reach states: each of these reads as a box flag or the callee's own pin, which only the
    // declaration tells (the bridge's reader, network-text-one-to-one F9)
    const output = box.pins.find((a) => a.output && ["ENO", "OUT"].includes(a.param?.name.toUpperCase() ?? ""))
    const what = box.enable !== undefined ? "EN :=" : output !== undefined ? `${output.param!.name} =>` : undefined
    if (what !== undefined)
      emit(out, at, CODE, `${what} on the call ${head}, whose callee no declaration in reach states: it is a box flag or the callee's own pin, which only the declaration tells`)
    return
  }
  if (declaresOut(signature)) emit(out, at, CODE, `${type} declares VAR_OUTPUT OUT, which also names its value: the text cannot tell the two apart`)
  if (signature !== undefined && !declaresEn(signature)) {
    const enAgain = box.pins.find((a) => !a.output && a.param?.name.toUpperCase() === "EN")
    if (enAgain !== undefined)
      emit(out, enAgain.span, CODE, box.enable === undefined
        ? `EN := stands first in the call ${head}: it is the box's shown EN`
        : `the call ${head} holds EN := twice`)
  }
  if (signature === undefined || (member !== undefined && member.toUpperCase() === "ENO" && !declaresEno(signature))) return
  const outputs = box.instance !== undefined ? signature.outputs : dataOutputs(signature)
  if (member === undefined) {
    if (consumed && box.enable === undefined && outputs.length === 0) emit(out, at, CODE, `the box ${head} is read, and ${type} declares no output to read`)
    return
  }
  if (!outputs.some((o) => o.toLowerCase() === member.toLowerCase()))
    emit(out, at, CODE, `the box ${head} is closed by .${member}, which names no output of ${type} (${outputs.join(", ")})`)
}
