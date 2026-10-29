/**
 * ONE BOX OF A PLAIN-ST NETWORK BODY (`_plain-st.ts`, the one network check, holds the rest): the call a box is, held as
 * the bridge's reader holds it (`StNetworkReader` `CallBox`, openspec network-output-member) and refused in its words.
 */
import { type CallExpr } from "../../../frontend/syntax/index.js"
import { type Scope } from "../../../frontend/symbols/index.js"
import { dataOutputs, declaresEn, declaresEno, declaresOut, inferExprType, networkBox } from "../../../frontend/types/index.js"
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
 * ONE BOX, as the bridge's reader holds it (`StNetworkReader` `CallBox`, network-output-member): the call of its instance
 * (an FB) or its callee, `EN :=` first, the member closing it.
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
  if (declaresOut(signature)) emit(out, at, CODE, `${type} declares VAR_OUTPUT OUT, which also names its value: the text cannot tell the two apart`)
  if (signature !== undefined && !declaresEn(signature)) {
    const enAgain = box.pins.find((a) => !a.output && a.param?.name.toUpperCase() === "EN")
    if (enAgain !== undefined)
      emit(out, enAgain.span, CODE, box.enable === undefined
        ? `EN := stands first in the call ${head}: it is the box's shown EN`
        : `the call ${head} holds EN := twice`)
  }
  const eno = member !== undefined && member.toUpperCase() === "ENO" && !declaresEno(signature)
  if (signature !== undefined && !eno && !declaresEno(signature) && box.pins.some((a) => a.output && a.param?.name.toUpperCase() === "ENO"))
    emit(out, at, CODE, `the call ${head} wires ENO => and shows no ENO: ENO => v is a target of the shown ENO, which its call closed by .ENO states`)
  if (eno || !consumed || signature === undefined) return
  const outputs = box.instance !== undefined ? signature.outputs : dataOutputs(signature)
  if (member === undefined) {
    if (outputs.length === 0) emit(out, at, CODE, `the box ${head} is read, and ${type} declares no output to read`)
    else if (outputs.length > 1)
      emit(out, at, CODE, `the box ${head} is read and names no output: ${type} has ${outputs.length} (${outputs.join(", ")}), so its call is closed by the one its consumer reads, .${outputs[0]}`)
    return
  }
  if (!outputs.some((o) => o.toLowerCase() === member.toLowerCase()))
    emit(out, at, CODE, `the box ${head} is closed by .${member}, which names no output of ${type} (${outputs.join(", ")})`)
  else if (outputs.length === 1)
    emit(out, at, CODE, `the box ${head} is closed by .${member}, the one output ${type} has: a box with one output names none`)
}
