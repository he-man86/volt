/**
 * bit-usage (declarations/) — the placement rules for the 1-bit `BIT` type, one decl walk, four codes:
 *   C0205 pointer-to-bit  — `POINTER TO BIT`.
 *   C0206 bit-array-base  — `ARRAY[…] OF BIT`.
 *   C0203 bit-wrong-container — a plain `BIT` var in a PROGRAM/FUNCTION/METHOD or a global list (only structs/FBs may
 *                               hold BIT; a GVL's `ty_bit_in_gvl`, both vendors 2026-10-03).
 *   C0204 bit-wrong-block     — a plain `BIT` var in an FB but a disallowed block (only VAR_INPUT/VAR_OUTPUT/VAR).
 *
 * Zero-FP: `BIT` in any of these positions is always an error; struct fields (a DUT body, not a var section)
 * and FB VAR_INPUT/VAR_OUTPUT/VAR are the legal cases and are never visited/flagged.
 */
import type { TypeExpr } from "../../../frontend/syntax/index.js"
import type { CheckContext } from "../../pipeline/context.js"
import { forEachDecl } from "../../../frontend/symbols/index.js"
import { emit, type DiagnosticItem } from "../../shared/diagnostic-item.js"

const BIT_OK_SECTIONS = new Set(["VAR_INPUT", "VAR_OUTPUT", "VAR"])
const BIT_C0203_POUS = new Set(["program", "function", "method", "global_var_list"])

const isBit = (t: TypeExpr): boolean => t.kind === "named_type" && t.name.text.toUpperCase() === "BIT"

export function checkBitUsage(ctx: CheckContext, out: DiagnosticItem[]): void {
  for (const { unit, section, decl } of forEachDecl(ctx.parseResult, ctx.project)) {
    const t = decl.type
    const span = t.span
    if (t.kind === "pointer_type" && isBit(t.target)) {
      emit(out, span, "pointer-to-bit", ctx.messages.pointerToBit()) // C0205
    } else if (t.kind === "array_type" && isBit(t.element)) {
      emit(out, span, "bit-array-base", ctx.messages.bitArrayBase()) // C0206
    } else if (isBit(t)) {
      if (unit.kind === "function_block") {
        if (!BIT_OK_SECTIONS.has(section.sectionKind))
          emit(out, span, "bit-wrong-block", ctx.messages.bitInWrongBlock()) // C0204
      } else if (BIT_C0203_POUS.has(unit.kind)) {
        emit(out, span, "bit-wrong-container", ctx.messages.bitInWrongContainer()) // C0203
      }
    }
  }
}

