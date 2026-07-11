/**
 * type-refs — the ONE walk of a unit's type-position name references. A "type-position" is anywhere a type
 * NAME appears: a VAR/field/return/property/alias type (`position: "type"`) or an `EXTENDS`/`IMPLEMENTS` base
 * (`position: "base"`). Two consumers share it, so they can never drift:
 *   - `unknown-type` (diagnostics) — checks `position: "type"`, unqualified names resolve nowhere.
 *   - `findReferences` (rename/references) — matches EVERY ref (incl. bases) to the target symbol, so
 *     renaming a type also updates its `: T` / `EXTENDS T` / `IMPLEMENTS T` uses (the P0 rename-corruption bug).
 */
import type { Identifier, TopLevel, TypeExpr } from "./ast.js"
import type { Span } from "./span.js"

export interface TypeNameRef {
  name: string
  span: Span
  /** A qualified `NS.Type` — the root may be a library namespace the resolver can't see. */
  qualified: boolean
  /** "type" = a declared type position (var/return/field/alias); "base" = an EXTENDS/IMPLEMENTS reference. */
  position: "type" | "base"
}

/** Flatten namespace-wrapped units so a `NAMESPACE … END_NAMESPACE` body is walked too. */
export function flatUnits(units: readonly TopLevel[]): TopLevel[] {
  const out: TopLevel[] = []
  for (const u of units) {
    if (u.kind === "namespace") out.push(...flatUnits(u.units))
    else out.push(u)
  }
  return out
}

/** Every named-type reference a unit makes, in type or base position (unit assumed already namespace-flattened). */
export function* unitTypeNameRefs(unit: TopLevel): Generator<TypeNameRef> {
  for (const t of unitTypeExprs(unit)) yield* namedTypesOf(t)
  for (const id of unitBaseRefs(unit)) yield { name: id.text, span: id.span, qualified: false, position: "base" }
}

/** Every TypeExpr a unit DECLARES (var/field/return/property/alias types) — the checkable type positions. */
export function* unitTypeExprs(unit: TopLevel): Generator<TypeExpr> {
  if ("varSections" in unit) for (const section of unit.varSections) for (const decl of section.decls) yield decl.type
  if ("returnType" in unit && unit.returnType !== undefined) yield unit.returnType
  if (unit.kind === "property") {
    yield unit.dataType
    for (const acc of [unit.getter, unit.setter])
      if (acc !== undefined) for (const section of acc.varSections) for (const decl of section.decls) yield decl.type
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

/** The EXTENDS/IMPLEMENTS base identifiers of a unit (FB single + extra bases + implements; interface/struct bases). */
function* unitBaseRefs(unit: TopLevel): Generator<Identifier> {
  const u = unit as {
    kind: string
    extends?: Identifier | Identifier[]
    extendsExtra?: Identifier[]
    implements?: Identifier[]
    body?: { kind: string; extends?: Identifier }
  }
  if (u.extends !== undefined) yield* Array.isArray(u.extends) ? u.extends : [u.extends]
  if (u.extendsExtra !== undefined) yield* u.extendsExtra
  if (u.implements !== undefined) yield* u.implements
  if (u.kind === "type_decl" && (u.body?.kind === "struct" || u.body?.kind === "union") && u.body.extends !== undefined)
    yield u.body.extends
}

/** Bare/qualified named-type leaves of a TypeExpr, drilling through array/pointer/reference wrappers. */
function* namedTypesOf(t: TypeExpr): Generator<TypeNameRef> {
  switch (t.kind) {
    case "named_type":
      yield {
        name: t.name.text,
        span: t.name.span,
        qualified: t.qualifiers !== undefined && t.qualifiers.length > 0,
        position: "type",
      }
      return
    case "array_type":
      yield* namedTypesOf(t.element)
      return
    case "pointer_type":
    case "reference_type":
      yield* namedTypesOf(t.target)
      return
    // string_type / implicit_enum_type carry no named type to resolve.
  }
}
