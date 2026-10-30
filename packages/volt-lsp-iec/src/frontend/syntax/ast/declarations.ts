/**
 * Questions about DECLARATIONS answered from the tree alone — no scope, no types.
 */
import type { Identifier, TopLevel, TypeExpr, VarSection } from "./nodes/index.js"
import { allUnits } from "./walk.js"

/** The VAR_INPUT parameters (name + declared type) of a POU/method's var sections, in order. */
export function varInputParams(sections: readonly VarSection[]): { name: Identifier; type: TypeExpr }[] {
  const out: { name: Identifier; type: TypeExpr }[] = []
  for (const section of sections) {
    if (section.sectionKind !== "VAR_INPUT") continue
    for (const decl of section.decls) for (const id of decl.names) out.push({ name: id, type: decl.type })
  }
  return out
}

/**
 * A type a declaration writes, and HOW MANY things that declaration declares of it: each name of a variable or a field
 * (`a, b : T`), one result, one alias target, one enumeration base — and for a PROPERTY its accessors, each a routine of
 * that type, plus the property itself beside them (`accessors + 1`, none when it has no accessor: an INTERFACE PROPERTY
 * with neither GET nor SET compiles nothing, `tref_interface_property_type`).
 */
interface DeclaredType {
  type: TypeExpr
  declares: number
}

/**
 * EVERY TYPE A DECLARATION WRITES, in source order — the one census of the positions a type name stands in (openspec
 * dut-unknown-field-type, its class sweep): a variable's in every VAR section of every unit (a METHOD's, a FUNCTION's, a
 * GVL's, a PROPERTY accessor's, an INTERFACE method's and property accessor's), a STRUCT's and a UNION's field, an alias's
 * target, an enumeration's base, a FUNCTION's, a METHOD's and an INTERFACE METHOD's result, a PROPERTY's and an INTERFACE
 * PROPERTY's type. The type as written: what stands INSIDE it (an ARRAY's element, a POINTER's target) is the consumer's.
 *
 * Not here, by what they are: EXTENDS and IMPLEMENTS name a unit, not a type expression (`oop/inheritance`); a return type
 * on a PROGRAM or a FUNCTION_BLOCK is refused as such (C0182) and no type of anything.
 */
export function* declaredTypes(units: readonly TopLevel[]): Generator<DeclaredType> {
  const one = (type: TypeExpr): DeclaredType => ({ type, declares: 1 })
  const property = (type: TypeExpr, accessors: number): DeclaredType => ({ type, declares: accessors === 0 ? 0 : accessors + 1 })
  for (const u of allUnits(units)) {
    switch (u.kind) {
      case "type_decl": {
        const b = u.body
        if (b.kind === "struct" || b.kind === "union") for (const d of b.fields) yield { type: d.type, declares: d.names.length }
        else if (b.kind === "alias") yield one(b.target)
        else if (b.kind === "enum" && b.baseType !== undefined) yield one(b.baseType)
        break
      }
      case "interface":
        for (const m of u.methods) {
          if (m.returnType !== undefined) yield one(m.returnType)
          yield* sectionTypes(m.varSections)
        }
        for (const p of u.properties) {
          yield property(p.dataType, Number(p.hasGetter) + Number(p.hasSetter))
          yield* sectionTypes(p.getterVarSections)
          yield* sectionTypes(p.setterVarSections)
        }
        break
      case "property":
        yield property(u.dataType, Number(u.getter !== undefined) + Number(u.setter !== undefined))
        for (const accessor of [u.getter, u.setter]) if (accessor !== undefined) yield* sectionTypes(accessor.varSections)
        break
      case "function":
      case "method":
        if (u.returnType !== undefined) yield one(u.returnType)
        yield* sectionTypes(u.varSections)
        break
      case "function_block":
      case "program":
      case "global_var_list":
        yield* sectionTypes(u.varSections)
        break
      case "action":
      case "namespace":
        break
    }
  }
}

function* sectionTypes(sections: readonly VarSection[]): Generator<DeclaredType> {
  for (const section of sections) for (const decl of section.decls) yield { type: decl.type, declares: decl.names.length }
}
