/**
 * declared-type (declarations/) — a declared TYPE both vendors refuse once it is read, though it parses
 * (frontend-conformance 2.3.6, `test/conformance/fixtures/grammar/type-expressions.ts`, both vendors 2026-10-01):
 *   border-order               a subrange whose lower bound folds above its upper (`INT(10..0)`), an array dimension
 *                              whose lower bound folds above its upper PLUS ONE (`ARRAY[5..1]`, `ARRAY[2..0]`) — an
 *                              EMPTY dimension `1..0` is admitted (`qf_c0228_bound_literal_empty`, both vendors) —
 *                              "Lower border must be lower than upper border";
 *   reference-base-type        a REFERENCE as the base of an array, a pointer or a reference (`ARRAY OF REFERENCE TO
 *                              INT`, `POINTER TO REFERENCE TO INT`, `REFERENCE TO REFERENCE TO INT`), a STRUCT's component's
 *                              too;
 *   vector-base-type           a `__VECTOR` of an elementary type other than REAL/LREAL (CODESYS; TwinCAT has none);
 *   variable-length-placement  an `ARRAY[*]` outside the sections each vendor's own sentence names: VAR_IN_OUT
 *                              anywhere, and on CODESYS a function's or a method's VAR_INPUT too — a STRUCT field is
 *                              none of them (`decl_array_star_in_*`, `decl_array_star_struct_field`, all measured);
 *   variable-length-nested     an `ARRAY[*]` INSIDE another type — an array's element, a pointer's or a reference's
 *                              target — in any section, VAR_IN_OUT too (`decl_array_star_nested_in_var`, `_in_inout`,
 *                              `decl_pointer_to_array_star_in_var`).
 *
 * Zero-FP: a bound that does not fold is not compared, and a vector's element type is judged only when it names an
 * elementary type (an alias or a structured type, which no recording decides, is not).
 */
import { forEachDecl } from "../../../frontend/symbols/index.js"
import type { Expr, TypeExpr, Span, VarDecl, VarSectionKind } from "../../../frontend/syntax/index.js"
import { constEval, isElementaryTypeName } from "../../../frontend/types/index.js"
import type { Scope } from "../../../frontend/symbols/index.js"
import type { CheckContext } from "../../pipeline/context.js"
import { SOURCE, withFixes, type DiagnosticItem, type Fix } from "../../shared/diagnostic-item.js"
import { swapBoundsFix } from "../../shared/fixes.js"

export function checkDeclaredType(ctx: CheckContext, out: DiagnosticItem[]): void {
  const push = (span: Span, code: string, message: string, fix?: Fix) => out.push(withFixes({ severity: "error", span, source: SOURCE, code, message }, [fix]))
  // a STRUCT field holds a declared type too, and takes no ARRAY[*]: no call lends it (forEachDecl walks
  // var sections only, so the fields are walked here)
  // …and a REFERENCE as an array's, a pointer's or a reference's base type there too (`refbit_struct_array_component`, the
  // analysis-conformance 3.11 gate review, both vendors)
  for (const unit of ctx.parseResult.units)
    if (unit.kind === "type_decl" && unit.body.kind === "struct")
      for (const decl of unit.body.fields) {
        checkVariableLength(ctx, decl, false, push)
        walk(decl.type, (t, base) => {
          if (base && t.kind === "reference_type") push(t.span, "reference-base-type", ctx.messages.referenceAsBaseType())
        })
      }
  for (const { unit, section, decl, scope } of forEachDecl(ctx.parseResult, ctx.project)) {
    checkVariableLength(ctx, decl, takesVariableLength(ctx.config.vendor, unit.kind, section.sectionKind), push)
    walk(decl.type, (t, base) => {
      if (base && t.kind === "reference_type") push(t.span, "reference-base-type", ctx.messages.referenceAsBaseType())
      if (t.kind === "named_type" && t.subrange !== undefined && reversed(t.subrange.lo, t.subrange.hi, scope, 0n))
        push(t.subrange.span, "border-order", ctx.messages.borderOrder(), swapBoundsFix(ctx.source, t.subrange.lo.span, t.subrange.hi.span))
      if (t.kind !== "array_type") return
      for (const d of t.dims)
        if (reversed(d.lower, d.upper, scope, 1n)) push(d.span, "border-order", ctx.messages.borderOrder(), d.lower !== undefined && d.upper !== undefined ? swapBoundsFix(ctx.source, d.lower.span, d.upper.span) : undefined)
      if (t.vector !== undefined && !vectorElement(t.element)) push(t.span, "vector-base-type", ctx.messages.vectorBaseType())
    })
  }
}

/**
 * An `ARRAY[*]` in `decl`'s type: at its top, refused unless the slot `lends` (a section a call fills); anywhere below
 * its top — an array's element, a pointer's or a reference's target — refused wherever it stands.
 */
function checkVariableLength(ctx: CheckContext, decl: VarDecl, lends: boolean, push: (span: Span, code: string, message: string) => void): void {
  const at = decl.names[0]?.span ?? decl.type.span
  if (variableLength(decl.type) && !lends) push(at, "variable-length-placement", ctx.messages.variableLengthPlacement())
  let nested = false
  walk(decl.type, (t, base) => {
    if (base && variableLength(t)) nested = true
  })
  if (nested) push(at, "variable-length-nested", ctx.messages.variableLengthNested())
}

const variableLength = (t: TypeExpr): boolean => t.kind === "array_type" && t.dims.some((d) => d.dynamic)

/** Every type in `t`, outermost first; `base` when it is the base type of an array, a pointer or a reference. */
function walk(t: TypeExpr, visit: (t: TypeExpr, base: boolean) => void, base = false): void {
  visit(t, base)
  if (t.kind === "array_type") walk(t.element, visit, true)
  else if (t.kind === "pointer_type" || t.kind === "reference_type") walk(t.target, visit, true)
}

/**
 * Both bounds fold and the lower is above the upper by more than `empty`. An ARRAY dimension may be EMPTY — `1..0` builds
 * clean however it is written: literally (`qf_c0228_bound_literal_empty`), from a constant that is 0
 * (`qf_c0228_bound_init_zero`), from one with no initial value (`qf_c0228_bound`) or initialized from one
 * (`qf_c0228_bound_chained`) — while `2..0` is refused (`qf_c0228_bound_literal_two_below`), CODESYS 2026-10-12. A
 * subrange's `lo = hi + 1` is unmeasured, so a subrange keeps the plain order (`empty` 0).
 */
function reversed(lo: Expr | undefined, hi: Expr | undefined, scope: Scope, empty: bigint): boolean {
  if (lo === undefined || hi === undefined) return false
  const l = constEval(lo, scope)
  const h = constEval(hi, scope)
  return typeof l === "bigint" && typeof h === "bigint" && l > h + empty
}

/** A vector's element type is refused only when it is ANOTHER ELEMENTARY type — the measured cells (INT, BOOL). */
function vectorElement(t: TypeExpr): boolean {
  if (t.kind !== "named_type") return true
  const name = t.name.text.toUpperCase()
  if (name === "REAL" || name === "LREAL") return true
  return (t.qualifiers?.length ?? 0) > 0 || !isElementaryTypeName(name)
}

/**
 * Where an `ARRAY[*]` may stand, as each vendor's sentence says it: CODESYS "only … as VAR_IN_OUT of function blocks or
 * as VAR_IN_OUT and VAR_INPUT of methods and functions", TwinCAT "only … as VAR_IN_OUT of Methods, Functions and
 * Functionblocks". A VAR_IN_OUT is taken in every unit (an interface's methods declare them, the corpora build). Both
 * halves of the CODESYS VAR_INPUT measured: a function's and a method's build and run (`decl_array_star_in_function_input`,
 * `_in_method_input`), and TwinCAT refuses both.
 */
function takesVariableLength(vendor: "codesys" | "twincat", unitKind: string, section: VarSectionKind): boolean {
  if (section === "VAR_IN_OUT") return true
  return vendor === "codesys" && section === "VAR_INPUT" && (unitKind === "function" || unitKind === "method")
}
