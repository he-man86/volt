/**
 * unknown-type (D.2 · names/). A DECLARED type name that resolves NOWHERE — not an elementary/ANY_*
 * primitive, not a project-declared type/FB/interface/enum/struct/alias, not a catalog built-in, not a
 * referenced-library namespace — → error. This is the `x : BOL` typo the compilers reject outright, and
 * the sibling of `unresolved-identifier`: that check covers name refs in bodies, this one covers name refs
 * in type position (VAR decls, return types, property/struct-field types, alias targets, array/pointer
 * element types).
 *
 * Resolution reuses the SAME oracle as `unresolved-identifier` (`nameResolves`) plus the elementary/ANY_*
 * primitives, so the skip surface is identical by construction: a type name this flags is one the compiler
 * would reject, and a library/namespace type it cannot see is one `unresolved-identifier` also cannot see
 * (the shared "library floor"). Two whole-skips keep it zero-FP: a QUALIFIED name (`NS.Type`) — the
 * resolver keys on the last segment only and the root may be a library namespace — and a name resolved by
 * the containing scope, which covers VAR_GENERIC type params (`T : ANY` used as a type in the same POU).
 *
 * PROVISIONAL wording — no live-bridge recording yet (bridge-gated, like `notAMember`/`arrayIndexOutOfBounds`).
 */
import type { Identifier, TopLevel, TypeExpr } from "../../../syntax/index.js"
import { scopeForUnit } from "../../../symbols/index.js"
import { isKnownPrimitive } from "../../../types/index.js"
import type { CheckContext } from "../../diagnostics.js"
import { SOURCE, type DiagnosticItem } from "../_shared.js"
import { nameResolves } from "./_identifier-resolution.js"

export function checkUnknownTypes(ctx: CheckContext, out: DiagnosticItem[]): void {
  if (!ctx.config.lints.unknownType) return // opt-in: FP-prone below the "library floor" (see header)
  for (const unit of flatUnits(ctx.parseResult.units)) {
    const scope = scopeForUnit(ctx.project, unit) ?? ctx.project
    for (const t of unitTypeExprs(unit)) {
      collectNamedTypes(t, (ref) => {
        if (isKnownPrimitive(ref.name) || nameResolves(ref.name, scope, ctx.project, ctx.references)) return
        out.push({
          severity: "error",
          span: ref.span,
          source: SOURCE,
          code: "unknown-type",
          message: ctx.messages.unknownType(ref.name),
        })
      })
    }
  }
}

/** Flatten namespace-wrapped units so a `NAMESPACE … END_NAMESPACE` body is checked too. */
function flatUnits(units: readonly TopLevel[]): TopLevel[] {
  const out: TopLevel[] = []
  for (const u of units) {
    if (u.kind === "namespace") out.push(...flatUnits(u.units))
    else out.push(u)
  }
  return out
}

/** Every TypeExpr a unit DECLARES (var/field/return/property/alias types) — the checkable type positions. */
function* unitTypeExprs(unit: TopLevel): Generator<TypeExpr> {
  if ("varSections" in unit) {
    for (const section of unit.varSections) for (const decl of section.decls) yield decl.type
  }
  if ("returnType" in unit && unit.returnType !== undefined) yield unit.returnType
  if (unit.kind === "property") {
    yield unit.dataType
    for (const acc of [unit.getter, unit.setter]) {
      if (acc !== undefined) for (const section of acc.varSections) for (const decl of section.decls) yield decl.type
    }
  }
  if (unit.kind === "interface") {
    for (const m of unit.methods) {
      if (m.returnType !== undefined) yield m.returnType
      for (const section of m.varSections) for (const decl of section.decls) yield decl.type
    }
    for (const p of unit.properties) yield p.dataType
  }
  if (unit.kind === "type_decl") {
    const body = unit.body
    if (body.kind === "struct" || body.kind === "union") for (const f of body.fields) yield f.type
    if (body.kind === "alias") yield body.target
  }
}

/** Bare (unqualified) named-type leaves of a TypeExpr, drilling through array/pointer/reference wrappers. */
function collectNamedTypes(t: TypeExpr, emit: (ref: { name: string; span: Identifier["span"] }) => void): void {
  switch (t.kind) {
    case "named_type":
      // Qualified (`NS.Type`) → skip: the root may be a library namespace the resolver can't see.
      if (t.qualifiers === undefined || t.qualifiers.length === 0) emit({ name: t.name.text, span: t.name.span })
      return
    case "array_type":
      collectNamedTypes(t.element, emit)
      return
    case "pointer_type":
    case "reference_type":
      collectNamedTypes(t.target, emit)
      return
    // string_type / implicit_enum_type carry no named type to resolve.
  }
}
