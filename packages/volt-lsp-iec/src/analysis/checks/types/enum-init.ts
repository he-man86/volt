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
 * global CONSTANT are taken. (The member a refused value leaves is 0, which then warns "The constant 0 is assigned to more
 * than one enumeration" beside a member written 0 — the duplicate-value rule, 3.11's.)
 *
 * Zero-FP: only the recorded kinds fire; anything else (an undecidable name, a library constant) is silent.
 */
import { scopeForUnit, type Scope } from "../../../frontend/symbols/index.js"
import { constancyOf, constEval, inferExprType, literalType, REAL_LITERAL_TYPE, renderType } from "../../../frontend/types/index.js"
import type { Expr } from "../../../frontend/syntax/index.js"
import type { CheckContext } from "../../pipeline/context.js"
import { stringLiteralMessageType } from "../../shared/rules.js"
import { emit, type DiagnosticItem } from "../../shared/diagnostic-item.js"

export function checkEnumInit(ctx: CheckContext, out: DiagnosticItem[]): void {
  for (const unit of ctx.parseResult.units) {
    if (unit.kind !== "type_decl" || unit.body.kind !== "enum") continue
    const scope = scopeForUnit(ctx.project, unit) ?? ctx.project
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
}

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
