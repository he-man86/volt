/**
 * A BOUND FILE'S STORES — every declaration's initializer, every statement's assignment, CASE label and FOR bound, and
 * the expressions' own stores (`bound-census-stores.ts`), in the order the type cross-check uses them up. One concern of
 * `bound-census.ts` (openspec lsp-same-standard 4.4).
 */
import { bodyConditionWorld } from "../../src/frontend/symbols/index.js"
import { compilerTypeText } from "../../src/frontend/syntax/index.js"
import { measuredStBody } from "./st-bodies.js"
import {
  type Expr,
  type Statement,
  type TopLevel,
  allUnits,
  bodyStatements,
  unitBodies,
  walkStatements,
} from "../../src/frontend/syntax/index.js"
import { type Scope, lookup, scopeForUnit, scopeUri } from "../../src/frontend/symbols/index.js"
import { UNKNOWN, inferExprType, resolveNamedType, resolveTypeExpr } from "../../src/frontend/types/index.js"
import { initializerWarnedTwice, isStructInit, messagesFor, structEcho } from "../../src/analysis/index.js"
import { BOOL, type Store, StoreWalk, unknownTarget } from "./bound-census-stores.js"
import { sites } from "./dumps-bound.js"
import type { Bound } from "./dumps.js"

export function storesOf(b: Bound, says: ReadonlySet<string> | undefined): Store[] {
  const walk = new StoreWalk(b, says)
  unitStores(walk, b.parsed.parseResult.units)
  // the conversions INSIDE an initializer the IDE checks twice are said twice too (`narrowing` walks the initializer with
  // `pushForDeclaration`: `cfold_expt`'s `REAL_TO_DINT(EXPT(…))` in an FB)
  const twice = new Set<Expr>()
  for (const unit of allUnits(b.parsed.parseResult.units))
    if ("varSections" in unit)
      for (const section of unit.varSections)
        for (const decl of section.decls)
          if (decl.init !== undefined && decl.init.kind !== "aggregate_init" && initializerWarnedTwice(unit, section)) twice.add(decl.init)
  for (const s of sites(b)) if (s.scope !== undefined && !walk.unparsed(s.expr)) walk.inner(s.expr, s.scope, twice.has(s.expr))
  return walk.out
}

/** Every unit's declaration and body stores. */
export function unitStores(walk: StoreWalk, units: readonly TopLevel[]): void {
  for (const unit of allUnits(units)) {
    const scope = scopeForUnit(walk.b.project, unit)
    if (scope === undefined) continue
    declarationStores(walk, unit, scope)
    for (const body of unitBodies(unit)) {
      if (!measuredStBody(body) || walk.unparsed(body)) continue
      const bodyScope = scope.children.find((s) => s.span === body.span) ?? scope
      walkStatements(bodyStatements(body, bodyConditionWorld(walk.b.project, unit, body)).statements, (s) => statementStores(walk, s, bodyScope))
    }
  }
}

function declarationStores(walk: StoreWalk, unit: TopLevel, scope: Scope): void {
  const b = walk.b
  // an ENUM member's value converts into the enum (`cc5_enum_init_not_convertible`: "Cannot convert type 'LREAL' to type
  // 'DUT_C5_ODD'")
  if (unit.kind === "type_decl" && unit.body.kind === "enum") {
    const enumType = resolveNamedType(unit.name.text, b.project, scopeUri(scope))
    for (const member of unit.body.values) if (member.value !== undefined) walk.store(enumType, member.value, scope)
  }
  if (!("varSections" in unit)) return
  for (const section of unit.varSections)
    for (const decl of section.decls) {
      // a STRUCT initializer on an elementary variable has no type, and is named by its text: "Cannot convert type
      // 'Unknown type: 'STRUCT(x := 1, y := 2)'' to type 'INT'" (`analysis/checks/types/struct-init`,
      // `cc3_unexpected_struct_init`)
      if (decl.init !== undefined && isStructInit(decl.init) && resolveTypeExpr(decl.type, b.project, 0, scope).kind === "elementary")
        walk.pair(compilerTypeText(decl.type), `Unknown type: '${structEcho(decl.init)}'`, "incompatible")
      // a REFERENCE declared `REF= x` binds x, named as the reference: "Cannot convert type 'STRING' to type
      // 'REFERENCE TO INT'", 'Unknown type: 'nope'' for an undeclared one (`refdecl_target_wrong_type`,
      // `refdecl_target_undeclared`, both vendors)
      if (decl.init !== undefined && decl.init.kind !== "aggregate_init" && decl.initOp === "REF=")
        walk.store(resolveTypeExpr(decl.type, b.project, 0, scope), decl.init, scope)
      if (decl.init !== undefined && decl.init.kind !== "aggregate_init" && decl.initOp === undefined)
        walk.store(resolveTypeExpr(decl.type, b.project, 0, scope), decl.init, scope, unknownTarget(resolveTypeExpr(decl.type, b.project, 0, scope), decl.type), undefined, undefined, initializerWarnedTwice(unit, section))
      // a REFUSED initializer still stores the value the compiler kept — the placeholder where the malformed
      // literal stood (`RefusedInit.value`): "Cannot convert type 'Unknown type: '!!!'ERROR'!!!'' to type 'TIME'"
      // (`cc_time_microsecond_literal`, `lit_init_*`, frontend-conformance 2.2a)
      const refused = decl.refusedInit?.value
      if (refused !== undefined) walk.store(resolveTypeExpr(decl.type, b.project, 0, scope), refused, scope, unknownTarget(resolveTypeExpr(decl.type, b.project, 0, scope), decl.type))
    }
}

function statementStores(walk: StoreWalk, s: Statement, bodyScope: Scope): void {
  const b = walk.b
  // `a := b := c` stores c into b and b into a — each `:=` link its own store (`assign_chained_plain`)
  if (s.kind === "assign" && s.chained !== undefined) {
    const places = [s.target, ...s.chained]
    const ops = [s.op, ...(s.chainOps ?? [])]
    places.forEach((place, i) => {
      if (ops[i] === undefined) walk.store(inferExprType(place, bodyScope, b.project), places[i + 1] ?? s.value, bodyScope)
    })
  }
  if (s.kind === "assign" && s.op === undefined && s.chained === undefined) {
    const target = inferExprType(s.target, bodyScope, b.project)
    const written = s.target.kind === "ident_expr" ? lookup(bodyScope, s.target.name)?.symbol.typeExpr : undefined
    // a SUBRANGE target of an assignment is named in its assignment form (`messages` `subrangeAssignTarget`)
    const subrange = target.kind === "elementary" && target.subrange !== undefined
      ? messagesFor(b.project.dialect === "twincat" ? "twincat" : "codesys").subrangeAssignTarget(target.name, target.subrange.lower, target.subrange.upper)
      : undefined
    walk.store(target, s.value, bodyScope, subrange ?? (written === undefined ? undefined : unknownTarget(target, written)))
  }
  // `S=` / `R=` read and set a BOOL — both sides convert to it (`stmt_s_eq_non_bool_*`, frontend-conformance 2.6)
  if (s.kind === "assign" && (s.op === "S=" || s.op === "R=")) {
    walk.store(BOOL, s.target, bodyScope)
    walk.store(BOOL, s.value, bodyScope)
  }
  // a literal bound with `REF=` is stored into the reference (`cc3_reference_assign`, `stmt_ref_eq_literal_value`) —
  // TwinCAT names the pair the other way round (`analysis/messages` `refAssignCannotConvert`)
  if (s.kind === "assign" && s.op === "REF=" && s.value.kind === "literal")
    walk.store(inferExprType(s.target, bodyScope, b.project), s.value, bodyScope, undefined, undefined, true)
  // …and a variable of another type is refused into it, named as itself (`analysis/checks/types/reference-assign`,
  // `dt_ref_assign_wrong_type`, `cv_pointer_to_reference`, `cv_reference_to_other_reference`, rule DT14)
  else if (s.kind === "assign" && s.op === "REF=")
    walk.store(inferExprType(s.target, bodyScope, b.project), s.value, bodyScope, undefined, undefined, true)
  // a FOR counts in ANY_INT: its control variable converts to it (`stmt_for_real_control`, `stmt_for_bool_control`)
  if (s.kind === "for") walk.store(UNKNOWN, s.controlVar, bodyScope, "ANY_INT")
  // a CASE label converts to the selector — a typed literal (`stmt_case_typed_label_other_type`) and an untyped one
  // (`lt_literal_case_label_out_of_range`, rule LT12) — and a FOR's TO bound to its counter
  // (`lt_literal_for_bounds_out_of_range`)
  if (s.kind === "case") {
    const selector = inferExprType(s.selector, bodyScope, b.project)
    for (const arm of s.arms)
      for (const label of arm.labels)
        if (label.value.kind === "literal" && (label.value.literalKind === "typed" || label.value.literalKind === "int")) walk.store(selector, label.value, bodyScope)
  }
  if (s.kind === "for") walk.store(inferExprType(s.controlVar, bodyScope, b.project), s.to, bodyScope)
}
