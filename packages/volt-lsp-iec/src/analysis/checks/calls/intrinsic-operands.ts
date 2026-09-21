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
import { elementaryType, elementaryTypeRef, inferExprType, inTypeGroup, isAssignable } from "../../../types/index.js"
import { conversionWarning, storeConversionError } from "../../rules.js"
import { CODESYS_ONLY_KEYWORDS, type Span } from "../../../syntax/index.js"
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
    // THE ARRAY BOUNDS OPERATORS WANT A VARIABLE-LENGTH ARRAY — on TwinCAT. `LOWER_BOUND(grid, 1)` where `grid`
    // is `ARRAY[-1..1, 3..9] OF INT` is refused there and folded by CODESYS, which is a real difference and not a
    // wording one: the same operators on an `ARRAY[*]` in-out compile clean on BOTH
    // (`callshape_bounds_of_sized_array` against `callshape_array_star_bounds` / `_bound_width`, 2026-09-20).
    // Gated on a FULLY-KNOWN array so an unresolved or library-typed argument never fires.
    if ((name === "LOWER_BOUND" || name === "UPPER_BOUND") && ctx.project.dialect === "twincat") {
      const t = inferExprType(arg, scope, ctx.project)
      if (t.kind === "array" && t.dims.length > 0 && t.dims.every((d) => !d.dynamic))
        push(out, "error", e.callee.span, "bounds-fixed-array", ctx.messages.boundsNeedVariableLength())
    }
    // `TEST_AND_SET` TAKES A DWORD BY ADDRESS, and the operand is converted into one exactly as an assignment
    // would convert it. Eleven operand types, identical on both vendors (`calls/atomic-operands.ts`, 2026-09-21),
    // and they fall into three:
    //
    //   DWORD, UDINT        nothing — 32 bits unsigned is already the representation, so no temporary is made
    //   BYTE/WORD/USINT     "'BYTE_TO_DWORD(flag)' is not allowed as operand for ADR" — the conversion is legal,
    //   INT/DINT            and its RESULT is a temporary, which has no address. A signed operand also carries
    //                       the sign-change warning the same conversion would carry in an assignment.
    //   BOOL/REAL/STRING    "Cannot convert type 'BOOL' to type 'DWORD'" — there is no conversion to refuse an
    //   LWORD               address for, so the conversion itself is what is reported.
    //
    // Written as that one sentence rather than a table: the refusal and the warning both come from the shared
    // assignment rules, so a type nobody probed answers the way the compilers answer it for `x : DWORD := flag`.
    if (name === "TEST_AND_SET" && lookup(scope, e.callee.name) === undefined) {
      const dword = elementaryTypeRef(elementaryType("DWORD")!)
      const refused = storeConversionError(dword, arg, arg.span, scope, ctx.project, ctx.messages)
      const t = inferExprType(arg, scope, ctx.project)
      const elem = t.kind === "elementary" ? t.elem : undefined
      if (refused !== undefined) out.push({ ...refused, code: "test-and-set-operand" })
      else if (elem !== undefined && !(elem.bits === 32 && !elem.signed)) {
        push(out, "error", arg.span, "test-and-set-operand", ctx.messages.invalidAdrOperand(`${elem.name}_TO_DWORD(${text(ctx.source, arg.span)})`))
        const warn = conversionWarning(dword, t, arg, ctx.messages)
        if (warn !== undefined) out.push(warn)
      }
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
    // TwinCAT has `__XADD` (with a signature of its own) and NO `__COMPARE_AND_SWAP` — it answers "Identifier
    // '__COMPARE_AND_SWAP' not defined" — so an operand rule for a name the dialect lacks is an invented error.
    // THE TWO VENDORS' `__XADD` ARE MIRROR IMAGES, and six operand types each say so (`calls/atomic-operands.ts`,
    // both recordings 2026-09-20, TwinCAT on x64): CODESYS takes the ADDRESS and refuses a DINT — "Cannot convert
    // type 'DINT' to type 'POINTER TO DINT'" — while TwinCAT takes the DINT ITSELF and refuses the pointer,
    // "Cannot convert type 'POINTER TO DINT' to type 'DINT'". INT and DWORD pass there (widening, and a sign
    // crossing TwinCAT does not warn about at an argument); LINT and LWORD do not.
    const ATOMIC_POINTER: Readonly<Record<string, string>> = { __XADD: "DINT", __COMPARE_AND_SWAP: "LWORD" }
    const tc = ctx.project.dialect === "twincat"
    const wants = CODESYS_ONLY_KEYWORDS.has(name) && tc ? undefined : ATOMIC_POINTER[name]
    if (wants !== undefined) {
      const t = inferExprType(arg, scope, ctx.project)
      const target = elementaryTypeRef(elementaryType(wants)!)
      const bad = tc ? t.kind !== "unknown" && (t.kind !== "elementary" || !isAssignable(target, t)) : t.kind !== "pointer" && t.kind !== "unknown"
      if (bad)
        push(
          out,
          "error",
          arg.span,
          "call-argument-type",
          ctx.messages.cannotConvert(compilerTypeName(t), tc ? wants : `POINTER TO ${wants}`),
        )
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
      // Conservative: fire only where the operand is UNAMBIGUOUSLY wrong — an interface ref / FB instance reads as
      // function_block; a reference/struct/unknown is skipped.
      //
      // A POINTER is wrong in the FIRST position and right in the second, which is the whole shape of the operator:
      // `__QUERYPOINTER(src, dst)` casts an interface reference INTO a pointer. Reading "a valid pointer" as valid
      // for either operand is what left `operand_querypointer` silent (measured: `POINTER TO INT` first operand,
      // "First operand of __QueryPointer must be an interface reference or the instance of a function block").
      const first = e.args[0]?.value
      const firstKind = first === undefined ? undefined : inferExprType(first, scope, ctx.project).kind
      if (first !== undefined && (firstKind === "elementary" || firstKind === "pointer"))
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
