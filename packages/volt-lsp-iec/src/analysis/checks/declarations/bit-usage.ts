/**
 * bit-usage (declarations/) — the placement rules for the 1-bit `BIT` type, one decl walk, five codes:
 *   C0205 pointer-to-bit  — `POINTER TO BIT`.
 *   C0206 bit-array-base  — `ARRAY[…] OF BIT`.
 *   C0203 bit-wrong-container — a plain `BIT` var in a PROGRAM/FUNCTION/METHOD or a global list (only structs/FBs may
 *                               hold BIT; a GVL's `ty_bit_in_gvl`, both vendors 2026-10-03).
 *   C0204 bit-wrong-block     — a plain `BIT` var in an FB but a disallowed block (only VAR_INPUT/VAR_OUTPUT/VAR); in a
 *                               VAR_TEMP CODESYS adds C0203 beside it, TwinCAT does not (`bitu_fb_var_temp`, 2026-10-06 —
 *                               VAR_IN_OUT, VAR_STAT and VAR CONSTANT measured too: the section alone, or legal).
 *
 *   reference-to-bit      — "References to bits are not possible" (analysis-conformance 3.11), the reference half of the
 *                               pointer rule, under a slug of its own: no catalog code carries the sentence, so it is
 *                               stamped with none (it travelled as C0205 until the 3.11 gate review — an attribution
 *                               CODESYS never states). A `REFERENCE TO BIT` anywhere, a STRUCT's component
 *                               too, in any POU and a GVL (`ty_reference_to_bit`, `refbit_var_input`, `refbit_struct_field`,
 *                               `refbit_gvl_reference`, `_program_var_reference`, `_function_var_reference`, both vendors),
 *                               as an ARRAY's element too (`refbit_struct_array_component`, `refbit_var_array_reference`);
 *                               and on CODESYS a plain `BIT` in a VAR_IN_OUT (CONSTANT or not, FB, FUNCTION, PROGRAM or
 *                               METHOD), passed by reference, beside the section's own message (`bitu_fb_var_in_out`,
 *                               `refbit_inout_constant_bit`, `refbit_function_inout_bit`, `refbit_program_inout_bit`,
 *                               `refbit_method_inout_bit`; TwinCAT says only the section's). NOT an ALIAS of REFERENCE TO
 *                               BIT: the IDE says it only once a variable of the alias exists (`refbit_alias_unused` builds;
 *                               CODESYS three times without a position) — a known divergence, niche.
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
    } else if (t.kind === "reference_type" && isBit(t.target)) {
      emit(out, span, "reference-to-bit", ctx.messages.referenceToBit())
    } else if (t.kind === "array_type" && isBit(t.element)) {
      emit(out, span, "bit-array-base", ctx.messages.bitArrayBase()) // C0206
    } else if (isBit(t)) {
      if (unit.kind === "function_block") {
        if (!BIT_OK_SECTIONS.has(section.sectionKind)) {
          emit(out, span, "bit-wrong-block", ctx.messages.bitInWrongBlock()) // C0204
          if (section.sectionKind === "VAR_TEMP" && ctx.config.vendor === "codesys")
            emit(out, span, "bit-wrong-container", ctx.messages.bitInWrongContainer()) // C0203
        }
      } else if (BIT_C0203_POUS.has(unit.kind)) {
        emit(out, span, "bit-wrong-container", ctx.messages.bitInWrongContainer()) // C0203
      }
      if (section.sectionKind === "VAR_IN_OUT" && ctx.config.vendor === "codesys") emit(out, span, "reference-to-bit", ctx.messages.referenceToBit())
    }
    for (const r of arrayElementBitRefs(t)) emit(out, r.span, "reference-to-bit", ctx.messages.referenceToBit())
  }
  // a STRUCT's (or UNION's) components are no VAR section: only the reference rule reaches them
  for (const unit of ctx.parseResult.units) {
    if (unit.kind !== "type_decl" || (unit.body.kind !== "struct" && unit.body.kind !== "union")) continue
    for (const field of unit.body.fields) {
      if (field.type.kind === "reference_type" && isBit(field.type.target)) emit(out, field.type.span, "reference-to-bit", ctx.messages.referenceToBit())
      for (const r of arrayElementBitRefs(field.type)) emit(out, r.span, "reference-to-bit", ctx.messages.referenceToBit())
    }
  }
}

/** A REFERENCE TO BIT as an ARRAY's element, at any depth of arrays (`refbit_struct_array_component`,
 *  `refbit_var_array_reference`, both vendors, beside the array's own "reference as base type" refusal). */
function arrayElementBitRefs(t: TypeExpr): TypeExpr[] {
  if (t.kind !== "array_type") return []
  const e = t.element
  if (e.kind === "reference_type" && isBit(e.target)) return [e]
  return arrayElementBitRefs(e)
}

