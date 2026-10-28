/**
 * ONE BOX OF A PLAIN-ST NETWORK BODY (`_plain-st.ts`, the one network check, holds the rest): the call a box is, held as
 * the bridge's reader holds it (`StNetworkReader` `CallBox`, openspec network-output-member) and refused in its words.
 */
import { type CallExpr, UNNAMED } from "../../../frontend/syntax/index.js"
import { lookup, lookupLocal, type Scope } from "../../../frontend/symbols/index.js"
import { dataOutputs, declaresEn, declaresEno, declaresOut, inferExprType, networkBox, resolveBareName } from "../../../frontend/types/index.js"
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
 * ONE BOX, as the bridge's reader holds it (`StNetworkReader` `CallBox`, network-output-member): its instance an operand,
 * of the type the call names; no instance called, no FB type called without one; `EN :=` first; the member closing it.
 */
export function checkBox(call: CallExpr, member: string | undefined, consumed: boolean, scope: Scope, project: Scope, out: DiagnosticItem[]): void {
  const box = networkBox(call, scope, project)
  if (box === undefined) return
  const type = calleeText(call)
  const at = call.callee.span
  if (box.instance !== undefined) {
    const inst = box.instance
    // FB := names an FB box's instance: the call of an operator, a function or a program has none
    if (call.callee.kind === "ident_expr") {
      const head = call.callee.name
      const sym = lookup(scope, head)?.symbol
      const builtin = sym === undefined ? resolveBareName(scope, head) : undefined
      if (sym?.kind === "function" || sym?.kind === "program" || (builtin?.kind === "builtin" && (builtin.builtin === "operator" || builtin.builtin === "conversion")))
        emit(out, at, CODE, `FB := on a call of ${head}, which is no function block: FB := names an FB box's instance`)
    }
    if (!(inst.kind === "ident_expr" || inst.kind === "member" || inst.kind === "index" || inst.kind === "deref"))
      emit(out, inst.span, CODE, `the FB box ${type} takes its instance as FB := <instance>: a variable, or ???`)
    else if (!(inst.kind === "ident_expr" && inst.name === UNNAMED)) {
      const declared = inferExprType(inst, scope, project)
      const last = (n: string) => n.slice(n.lastIndexOf(".") + 1).toLowerCase()
      if (declared.kind === "function_block" && last(declared.name) !== last(type))
        emit(out, at, CODE, `the FB box ${type} names the instance ${calleeText({ ...call, callee: inst })}, declared ${declared.name}: an FB box is the call of its instance's type`)
      else if (inst.kind === "ident_expr" && declared.kind !== "function_block" && declared.kind !== "unknown")
        emit(out, inst.span, CODE, `the FB box ${type} names ${inst.name} as its instance: ${inst.name} is no FB instance`)
    }
  } else if (call.callee.kind === "deref" || call.callee.kind === "index") {
    // `SUPER^(…)`, `fbs[1](…)`: an instance called — the box is the call of its type, the instance its first pin
    const typed = inferExprType(call.callee, scope, project).kind
    if (typed === "function_block" || typed === "unknown")
      emit(out, at, CODE, `the call ${calleeText(call)} names an FB instance: an FB box is the call of its type, its instance its first pin (FB := <instance>)`)
  } else if (call.callee.kind === "ident_expr") {
    const sym = lookup(scope, call.callee.name)?.symbol
    const typed = sym === undefined ? undefined : inferExprType(call.callee, scope, project).kind
    if (sym !== undefined && (sym.kind === "var" || sym.kind === "gvl_var" || sym.kind === "method_param") && (typed === "function_block" || typed === "unknown"))
      emit(out, at, CODE, `the call ${type} names an FB instance: an FB box is the call of its type, its instance its first pin (FB := ${type})`)
    // a FUNCTION of that name in any library wins over a block of it (bakon-nano: Standard's DELETE beside CAA File's), as
    // the bridge's scope answers it (`LibraryFunctions.Of`)
    else if (sym?.kind === "function_block" && !lookupLocal(project, call.callee.name).some((s) => s.kind === "function"))
      emit(out, at, CODE, `the FB box ${type} names no instance: its first pin is FB := <instance>, FB := ??? for none`)
  }
  const signature = box.signature
  if (declaresOut(signature)) emit(out, at, CODE, `${type} declares VAR_OUTPUT OUT, which also names its value: the text cannot tell the two apart`)
  if (signature !== undefined && !declaresEn(signature)) {
    const enAgain = box.pins.find((a) => !a.output && a.param?.name.toUpperCase() === "EN")
    if (enAgain !== undefined)
      emit(out, enAgain.span, CODE, box.enable === undefined
        ? `EN := stands first in the call ${type}${box.instance === undefined ? "" : ", after FB :="}: it is the box's shown EN`
        : `the call ${type} holds EN := twice`)
  }
  const eno = member !== undefined && member.toUpperCase() === "ENO" && !declaresEno(signature)
  if (signature !== undefined && !eno && !declaresEno(signature) && box.pins.some((a) => a.output && a.param?.name.toUpperCase() === "ENO"))
    emit(out, at, CODE, `the call ${type} wires ENO => and shows no ENO: ENO => v is a target of the shown ENO, which its call closed by .ENO states`)
  if (eno || !consumed || signature === undefined) return
  const outputs = box.instance !== undefined ? signature.outputs : dataOutputs(signature)
  if (member === undefined) {
    if (outputs.length === 0) emit(out, at, CODE, `the box ${type} is read, and ${type} declares no output to read`)
    else if (outputs.length > 1)
      emit(out, at, CODE, `the box ${type} is read and names no output: ${type} has ${outputs.length} (${outputs.join(", ")}), so its call is closed by the one its consumer reads, .${outputs[0]}`)
    return
  }
  if (!outputs.some((o) => o.toLowerCase() === member.toLowerCase()))
    emit(out, at, CODE, `the box ${type} is closed by .${member}, which names no output of ${type} (${outputs.join(", ")})`)
  else if (outputs.length === 1)
    emit(out, at, CODE, `the box ${type} is closed by .${member}, the one output ${type} has: a box with one output names none`)
}
