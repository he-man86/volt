/**
 * enum-init (C0124 · types/). An enumeration member initialized with a value its (always integer) base cannot take. Each
 * value kind as both vendors answer it (`eninit_*`, 2026-10-06; `cc5_enum_init_not_convertible`):
 *
 *   a REAL literal `2.5`        "2.5 is no valid initialisation for an enumeration" + "Cannot convert type 'LREAL' to type 'E'"
 *   a STRING literal `'x'`      "… no valid initialisation …" + "Cannot convert type 'STRING(INT#1)' to type 'E'"
 *   TRUE / FALSE                "… no valid initialisation …" + "Cannot convert type 'BOOL' to type 'E'"
 *   a TIME literal `T#1S`       only "Cannot convert type 'TIME' to type 'E'"
 *   a non-constant variable     "Initialisation of constant variable 'B' not constant" + "… no valid initialisation …"
 *   another enum's member       the warning "Implicit conversion from one enumeration type (S) to another (E)"
 *
 * The enum is named upper-cased, as the IDE prints an enum's name. A typed integer literal, a sibling's expression and a
 * global CONSTANT are taken.
 *
 * And the DUPLICATE VALUE (C0125, analysis-conformance 3.11): "The constant <n> is assigned to more than one enumeration", a
 * warning both vendors give at every member whose value an earlier member holds (`enumdup_three_alike`: two) — written,
 * implicit (one more than the member before, the first 0) or folded (a global CONSTANT, another enum's member, a sibling's
 * name, an earlier or a LATER one — `enumdup_forward_sibling`); on an inline enum of a variable or of a STRUCT's component
 * too (`enumdup_inline_enum`, `enumdup_struct_inline_enum`). A refused value (the "no valid initialisation"
 * kinds) leaves the member 0 (`eninit_*` beside `A := 0`; before a member written 0, `enumdup_refused_then_zero`; two
 * refused members meet at 0, `enumdup_two_refused`), and the member after it is no fact: `(1, 2.5, C)` is silent
 * (`enumdup_after_refused_implicit`), so its value is not one more than 0. A TIME value, or one that does not fold, is no
 * fact either, nor is the implicit member after it.
 *
 * Zero-FP: only the recorded kinds fire; anything else (an undecidable name, a library constant) is silent.
 */
import { forEachDecl, scopeForUnit, type Scope } from "../../../frontend/symbols/index.js"
import { constancyOf, constEval, inferExprType, literalType, REAL_LITERAL_TYPE, renderType } from "../../../frontend/types/index.js"
import type { Expr } from "../../../frontend/syntax/index.js"
import type { CheckContext } from "../../pipeline/context.js"
import { stringLiteralMessageType } from "../../shared/rules.js"
import { emit, type DiagnosticItem } from "../../shared/diagnostic-item.js"

export function checkEnumInit(ctx: CheckContext, out: DiagnosticItem[]): void {
  for (const unit of ctx.parseResult.units) {
    if (unit.kind !== "type_decl" || unit.body.kind !== "enum") continue
    const scope = scopeForUnit(ctx.project, unit) ?? ctx.project
    duplicateValues(unit.body.values, scope, ctx, out)
    const enumName = unit.name.text.toUpperCase()
    for (const member of unit.body.values) {
      const value = member.value
      if (value === undefined) continue
      const written = ctx.source.slice(value.span.start, value.span.end)
      const invalid = (): void => emit(out, value.span, "enum-init-not-convertible", ctx.messages.invalidEnumInitialisation(written))
      const refused = (from: string): void => emit(out, value.span, "enum-init-not-convertible", ctx.messages.cannotConvert(from, enumName))
      const kind = valueKind(value, scope, ctx)
      if (kind === undefined) continue
      switch (kind.kind) {
        case "time":
          refused(kind.type)
          break
        case "refused":
          invalid()
          refused(kind.type)
          break
        case "variable":
          emit(out, value.span, "enum-init-not-convertible", ctx.messages.constInitNonConst(member.name.text))
          invalid()
          break
        case "other-enum":
          emit(out, value.span, "enum-conversion", ctx.messages.enumConversion(kind.from, enumName), "warning")
      }
    }
  }
  // an inline enum of a variable (`e : (A := 1, B := 1)`) holds its members on the declaration
  for (const { decl, scope } of forEachDecl(ctx.parseResult, ctx.project))
    if (decl.type.kind === "implicit_enum_type") duplicateValues(decl.type.values, scope, ctx, out)
  // …and on a STRUCT's component (`enumdup_struct_inline_enum`, the 3.11 gate review): forEachDecl walks VAR sections only
  for (const unit of ctx.parseResult.units) {
    if (unit.kind !== "type_decl" || unit.body.kind !== "struct") continue
    const scope = scopeForUnit(ctx.project, unit) ?? ctx.project
    for (const field of unit.body.fields) if (field.type.kind === "implicit_enum_type") duplicateValues(field.type.values, scope, ctx, out)
  }
}

/** C0125 — every member whose value an earlier member holds; a value that is no fact is skipped (see the header). */
function duplicateValues(values: readonly EnumMember[], scope: Scope, ctx: CheckContext, out: DiagnosticItem[]): void {
  const held = new Set<bigint>()
  let next: bigint | undefined = 0n
  for (const member of values) {
    let value: bigint | undefined
    let follows = true
    if (member.value === undefined) value = next
    else {
      const kind = valueKind(member.value, scope, ctx)
      if (kind?.kind === "refused" || kind?.kind === "variable") {
        value = 0n
        follows = false
      } else if (kind?.kind === "time") value = undefined
      else {
        const folded = constEval(member.value, scope)
        value = typeof folded === "bigint" ? folded : undefined
      }
    }
    if (value !== undefined) {
      if (held.has(value)) emit(out, member.name.span, "enum-duplicate-value", ctx.messages.enumDuplicateValue(String(value)), "warning")
      held.add(value)
    }
    next = value !== undefined && follows ? value + 1n : undefined
  }
}

type EnumMember = { name: { text: string; span: DiagnosticItem["span"] }; value?: Expr }

type ValueKind = { kind: "refused" | "time"; type: string } | { kind: "variable" } | { kind: "other-enum"; from: string }

/** What a member's initial value is, among the kinds recorded — undefined for one that converts or is undecidable. */
function valueKind(value: Expr, scope: Scope, ctx: CheckContext): ValueKind | undefined {
  if (value.kind === "literal") {
    if (value.literalKind === "bool") return { kind: "refused", type: "BOOL" }
    const str = stringLiteralMessageType(value)
    if (typeof str === "string") return { kind: "refused", type: str }
    if (value.literalKind === "time") {
      const t = literalType(value)
      return t.kind === "elementary" && t.name === "TIME" ? { kind: "time", type: "TIME" } : undefined
    }
  }
  // a real value folds to a JS number (an integer one to a bigint)
  if (typeof constEval(value, scope) === "number") return { kind: "refused", type: REAL_LITERAL_TYPE }
  if (value.kind === "ident_expr" && constancyOf(value, scope) === "variable") return { kind: "variable" }
  if (value.kind === "member") {
    const t = inferExprType(value, scope, ctx.project)
    if (t.kind === "enum") return { kind: "other-enum", from: renderType(t, { form: "compiler" }) }
  }
  return undefined
}
