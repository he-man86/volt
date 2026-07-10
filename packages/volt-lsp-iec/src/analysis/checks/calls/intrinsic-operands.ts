/**
 * intrinsic-operands (calls/) — operand rules for the built-in address/memory operators:
 *   C0131 invalid-adr-operand — `ADR(<literal>)`; a literal constant has no address.
 *   C0355 adr-on-bit          — `ADR(<BIT var>)`; a single bit has no address (WARNING — the byte is used).
 *   C0242 delete-non-pointer  — `__DELETE(x)` where `x` is not a pointer.
 *   C0070 ini-needs-instance  — `INI(x, …)` where `x` is not an FB / DUT (struct) instance.
 *   C0072 operator-not-possible — a math operator (`ABS`, `SQRT`, …) applied to a non-numeric type. PROVISIONAL.
 *
 * Zero-FP: C0131 fires only on a bare literal argument; C0355 only when the argument's type is KNOWN BIT; C0242
 * only when the argument's type is KNOWN and not a pointer; C0070 only when the first operand's type is KNOWN
 * and not a function-block / struct instance (an unknown/undecidable argument skips). C0072 fires only when the
 * operator name is UNSHADOWED (a project/library symbol of the same name skips) and the argument's type is a
 * KNOWN non-numeric elementary (not ANY_NUM = int/bitstring/real).
 */
import { inferExprType } from "../../../types/index.js"
import type { Span } from "../../../syntax/index.js"
import { lookup } from "../../../symbols/index.js"
import type { CheckContext } from "../../diagnostics.js"
import { forEachExpr, SOURCE, type DiagnosticItem } from "../_shared.js"

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
const NUMERIC_FAMILIES = new Set(["int", "bitstring", "real"])
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
      if (t.kind === "elementary" && !NUMERIC_FAMILIES.has(t.elem.family))
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
  })
}

function push(out: DiagnosticItem[], severity: DiagnosticItem["severity"], span: Span, code: string, message: string): void {
  out.push({ severity, span, source: SOURCE, code, message })
}

const text = (source: string, span: Span): string => source.slice(span.start, span.end)
