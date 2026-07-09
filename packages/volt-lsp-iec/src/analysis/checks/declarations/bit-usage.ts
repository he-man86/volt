/**
 * bit-usage (declarations/) — the placement rules for the 1-bit `BIT` type, one decl walk, four codes:
 *   C0205 pointer-to-bit  — `POINTER TO BIT`.
 *   C0206 bit-array-base  — `ARRAY[…] OF BIT`.
 *   C0203 bit-wrong-container — a plain `BIT` var in a PROGRAM/FUNCTION/METHOD (only structs/FBs may hold BIT).
 *   C0204 bit-wrong-block     — a plain `BIT` var in an FB but a disallowed block (only VAR_INPUT/VAR_OUTPUT/VAR).
 *
 * Zero-FP: `BIT` in any of these positions is always an error; struct fields (a DUT body, not a var section)
 * and FB VAR_INPUT/VAR_OUTPUT/VAR are the legal cases and are never visited/flagged.
 */
import type { TypeExpr } from "../../../syntax/index.js"
import type { Span } from "../../../syntax/index.js"
import type { CheckContext } from "../../diagnostics.js"
import { SOURCE, type DiagnosticItem } from "../_shared.js"

const BIT_OK_SECTIONS = new Set(["VAR_INPUT", "VAR_OUTPUT", "VAR"])
const BIT_C0203_POUS = new Set(["program", "function", "method"])

const isBit = (t: TypeExpr): boolean => t.kind === "named_type" && t.name.text.toUpperCase() === "BIT"

export function checkBitUsage(ctx: CheckContext, out: DiagnosticItem[]): void {
  for (const unit of ctx.parseResult.units) {
    if (!("varSections" in unit)) continue
    for (const section of unit.varSections) {
      for (const decl of section.decls) {
        const t = decl.type
        const span = t.span
        if (t.kind === "pointer_type" && isBit(t.target)) {
          push(out, span, "pointer-to-bit", ctx.messages.pointerToBit()) // C0205
        } else if (t.kind === "array_type" && isBit(t.element)) {
          push(out, span, "bit-array-base", ctx.messages.bitArrayBase()) // C0206
        } else if (isBit(t)) {
          if (unit.kind === "function_block") {
            if (!BIT_OK_SECTIONS.has(section.sectionKind))
              push(out, span, "bit-wrong-block", ctx.messages.bitInWrongBlock()) // C0204
          } else if (BIT_C0203_POUS.has(unit.kind)) {
            push(out, span, "bit-wrong-container", ctx.messages.bitInWrongContainer()) // C0203
          }
        }
      }
    }
  }
}

function push(out: DiagnosticItem[], span: Span, code: string, message: string): void {
  out.push({ severity: "error", span, source: SOURCE, code, message })
}
