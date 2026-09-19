/**
 * intrinsic-operands (calls/) — operand rules for the built-in address/memory operators:
 *   C0131 invalid-adr-operand — `ADR(<literal>)`; a literal constant has no address.
 *   C0355 adr-on-bit          — `ADR(<BIT var>)`; a single bit has no address (WARNING — the byte is used).
 *   C0242 delete-non-pointer  — `__DELETE(x)` where `x` is not a pointer.
 *   C0070 ini-needs-instance  — `INI(x, …)` where `x` is not an FB / DUT (struct) instance.
 *   C0072 operator-not-possible — a math operator (`ABS`, `SQRT`, …) applied to a non-numeric type.
 *   C0240/C0241 query-pointer-operand   — `__QueryPointer` operands (interface-ref/FB, then pointer).
 *   C0234/C0235 query-interface-operand — `__QueryInterface` operands (interface-ref/FB, then interface-ref).
 *
 * Zero-FP: C0131 fires only on a bare literal argument; C0355 only when the argument's type is KNOWN BIT; C0242
 * only when the argument's type is KNOWN and not a pointer; C0070 only when the first operand's type is KNOWN
 * and not a function-block / struct instance (an unknown/undecidable argument skips). C0072 fires only when the
 * operator name is UNSHADOWED (a project/library symbol of the same name skips) and the argument's type is a
 * KNOWN non-numeric elementary (not ANY_NUM = int/bitstring/real).
 */
import { inferExprType, inTypeGroup } from "../../../types/index.js"
import type { Span } from "../../../syntax/index.js"
import { forEachExpr, lookup } from "../../../symbols/index.js"
import type { CheckContext } from "../../diagnostics.js"
import { compilerTypeName } from "../../messages.js"
import { SOURCE, type DiagnosticItem } from "../../diagnostic-item.js"

/** Math operators requiring an ANY_NUM operand — a non-numeric argument is C0072. */
const MATH_OPS = new Set(["ABS", "SQRT", "LN", "LOG", "EXP", "SIN", "COS", "TAN", "ASIN", "ACOS", "ATAN"])
/** Intrinsic-operator operand-count rules (C0022 exact / C0023 at-least). Only IEC-standard operators with an
 *  unambiguous arity — a real project's correct usage never fires (the corpus gate validates the table). */
const OP_ARITY: Record<string, { exact?: number; atLeast?: number }> = {
  ADR: { exact: 1 },
  SIZEOF: { exact: 1 },
  SEL: { exact: 3 },
  MUX: { atLeast: 3 },
}
const titleCase = (s: string): string => s.charAt(0) + s.slice(1).toLowerCase()

export function checkIntrinsicOperands(ctx: CheckContext, out: DiagnosticItem[]): void {
  forEachExpr(ctx.parseResult, ctx.project, (e, scope) => {
    if (e.kind !== "call" || e.callee.kind !== "ident_expr") return
    const name = e.callee.name.toUpperCase()

    // C0022 / C0023 — wrong operand count for an intrinsic operator. Unshadowed only (a project/library symbol
    // of the same name is a user function, not the operator). Anchored on the callee.
    const arity = OP_ARITY[name]
    if (arity !== undefined && lookup(scope, e.callee.name) === undefined) {
      const n = e.args.length
      if (arity.exact !== undefined && n !== arity.exact)
        push(out, "error", e.callee.span, "operator-operand-count", ctx.messages.operatorNeedsExactly(name, arity.exact)) // C0022
      else if (arity.atLeast !== undefined && n < arity.atLeast)
        push(out, "error", e.callee.span, "operator-operand-count", ctx.messages.operatorNeedsAtLeast(name, arity.atLeast)) // C0023
    }

    const arg = e.args[0]?.value
    if (arg === undefined) return
    if (MATH_OPS.has(name) && lookup(scope, e.callee.name) === undefined) {
      const t = inferExprType(arg, scope, ctx.project)
      if (t.kind === "elementary" && !inTypeGroup("ANY_NUM", t.elem))
        push(out, "error", arg.span, "operator-not-possible", ctx.messages.operatorNotPossible(titleCase(name), t.name)) // C0072
    }
    if (name === "ADR") {
      if (arg.kind === "literal") {
        push(out, "error", arg.span, "invalid-adr-operand", ctx.messages.invalidAdrOperand(text(ctx.source, arg.span))) // C0131
      } else {
        const t = inferExprType(arg, scope, ctx.project)
        if (t.kind === "elementary" && t.name === "BIT") push(out, "warning", arg.span, "adr-on-bit", ctx.messages.adrOnBit()) // C0355
      }
    }
    // THE ATOMICS WANT A POINTER, AND A FIXED ONE. `__XADD` names `POINTER TO DINT` whatever it was handed and
    // `__COMPARE_AND_SWAP` names `POINTER TO LWORD` — measured across five and three operand types respectively
    // (`calls/atomic-operands.ts`, 2026-09-19). The single `operand_xadd` recording used a DINT, which made the
    // pointer look derived from the operand; it is not.
    const ATOMIC_POINTER: Readonly<Record<string, string>> = { __XADD: "DINT", __COMPARE_AND_SWAP: "LWORD" }
    const wants = ATOMIC_POINTER[name]
    if (wants !== undefined) {
      const t = inferExprType(arg, scope, ctx.project)
      if (t.kind !== "pointer" && t.kind !== "unknown")
        push(out, "error", arg.span, "call-argument-type", ctx.messages.cannotConvert(compilerTypeName(t), `POINTER TO ${wants}`))
    }
    // INDEXOF WAS REMOVED IN SP21 and says so, whether it is handed a POU name or a variable (`operand_indexof`,
    // `atomic_indexof_variable`). It is not an operand rule — the operator is simply gone.
    if (name === "INDEXOF") push(out, "error", e.callee.span, "indexof-removed", ctx.messages.indexofRemoved())
    // BITADR IS REFUSED ON EVERY TYPE MEASURED — a BIT, a WORD and a BOOL, three different families, and nothing
    // recorded it succeeding. Same wording as C0072, with the vendor's own camel spelling of the name.
    if (name === "BITADR") {
      // A BIT ACCESS is the shape the original fixture uses — `BITADR(w.3)` — and it infers UNKNOWN, so the type
      // is named here. Same fact as the VAR_IN_OUT identity check: a numeric member is always a bit access.
      const bit = arg.kind === "member" && /^\d+$/.test(arg.member.name)
      const t = bit ? undefined : inferExprType(arg, scope, ctx.project)
      const named = bit ? "BIT" : t?.kind === "elementary" ? t.name : undefined
      if (named !== undefined)
        push(out, "error", arg.span, "operator-not-possible", ctx.messages.operatorNotPossible("BitAdr", named))
    }
    if (name === "__DELETE") {
      const t = inferExprType(arg, scope, ctx.project)
      if (t.kind !== "pointer" && t.kind !== "unknown")
        push(out, "error", arg.span, "delete-non-pointer", ctx.messages.deleteOperandNotPointer()) // C0242
    }
    if (name === "INI") {
      const t = inferExprType(arg, scope, ctx.project)
      if (t.kind !== "function_block" && t.kind !== "struct" && t.kind !== "unknown")
        push(out, "error", e.callee.span, "ini-needs-instance", ctx.messages.iniNeedsInstance()) // C0070
    }
    if (name === "__QUERYPOINTER") {
      // Conservative: fire only when an operand is a KNOWN ELEMENTARY (unambiguously wrong) — an interface ref /
      // FB instance reads as function_block, a valid pointer as pointer; a reference/struct/unknown is skipped.
      const first = e.args[0]?.value
      if (first !== undefined && inferExprType(first, scope, ctx.project).kind === "elementary")
        push(out, "error", first.span, "query-pointer-operand", ctx.messages.queryPointerFirst()) // C0240
      const second = e.args[1]?.value
      if (second !== undefined && inferExprType(second, scope, ctx.project).kind === "elementary")
        push(out, "error", second.span, "query-pointer-operand", ctx.messages.queryPointerSecond()) // C0241
    }
    if (name === "__QUERYINTERFACE") {
      // Same conservative rule (twin of __QueryPointer), but the second operand must be an interface reference,
      // not a pointer — a KNOWN ELEMENTARY is unambiguously wrong for either operand.
      const first = e.args[0]?.value
      if (first !== undefined && inferExprType(first, scope, ctx.project).kind === "elementary")
        push(out, "error", first.span, "query-interface-operand", ctx.messages.queryInterfaceFirst()) // C0234
      const second = e.args[1]?.value
      if (second !== undefined && inferExprType(second, scope, ctx.project).kind === "elementary")
        push(out, "error", second.span, "query-interface-operand", ctx.messages.queryInterfaceSecond()) // C0235
    }
  })
}

function push(out: DiagnosticItem[], severity: DiagnosticItem["severity"], span: Span, code: string, message: string): void {
  out.push({ severity, span, source: SOURCE, code, message })
}

const text = (source: string, span: Span): string => source.slice(span.start, span.end)
