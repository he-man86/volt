/**
 * What a variable is stored as: a type's storage and its layout, and the declarations that make a frame's slots.
 */
import type { AggregateElement, AggregateInit, Expr, Initializer, TypeDecl, TypeExpr, VarSection } from "../../syntax/index.js"
import { lookup } from "../../symbols/index.js"
import { DEFAULT_STRING_LENGTH, resolveNamedType, type Type } from "../../types/index.js"
import { defaultValueOf, type IrInit, type IrValue } from "../ir/index.js"
import { baseOf, Lowering, ZERO_SPAN } from "./lowering.js"
import { stored, valueAs } from "./convert.js"
import { calendarOf, durationOf, enumStorage, foldConstant, stringLiteralText, typedRealOf } from "./constants.js"

/** The FB variable sections that are an instance's storage. VAR_IN_OUT is not: it aliases the caller's variable. */
export const INSTANCE_STORAGE: ReadonlySet<string> = new Set(["VAR", "VAR_INPUT", "VAR_OUTPUT", "VAR_STAT", "VAR_TEMP"])

/** A slot's string type with its capacity stated: a sizeless STRING or WSTRING holds `DEFAULT_STRING_LENGTH`. */
export function withStringCapacity(t: Type): Type {
  if (t.kind !== "elementary" || t.length !== undefined || (t.name !== "STRING" && t.name !== "WSTRING")) return t
  return { ...t, length: DEFAULT_STRING_LENGTH }
}

/**
 * The type a variable is STORED as: a sizeless string with its capacity, a struct or FB under its DECLARED name (ST is
 * case-insensitive and Rust is not, so `fb_x : fb_conveyor` and `FB_Conveyor` must be one struct), an array of
 * those. Building it builds the layout of every composite type it reaches, dependencies first.
 */
export function storageOf(lw: Lowering, t: Type): Type {
  if (t.kind === "array") return { ...t, element: storageOf(lw, t.element) }
  if (t.kind === "enum") return enumStorage(lw, t)
  if (t.kind !== "struct" && t.kind !== "function_block") return withStringCapacity(t)
  const sym = lookup(lw.project, t.name)?.symbol
  const name = sym?.name ?? t.name
  const key = name.toUpperCase()
  if (!lw.layouts.has(key)) buildLayout(lw, { ...t, name }, sym)
  return { ...t, name }
}

/** A struct's fields or an FB instance's storage, lowered in the type's own scope — a base type's fields first. */
export function buildLayout(lw: Lowering, t: Extract<Type, { kind: "struct" | "function_block" }>, sym: ReturnType<typeof lookup> extends infer R ? (R extends { symbol: infer S } ? S : never) | undefined : never): void {
  const nested = new Lowering(t.scope ?? lw.project, lw.project, lw.shared)
  nested.selfType = t
  nested.codeOwner = t.scope
  nested.frameContext = `FB:${t.name.toUpperCase()}`
  const base = (name: string | undefined): void => {
    if (name === undefined) return
    const baseType = storageOf(lw, resolveNamedType(name, lw.project))
    const layout = baseType.kind === "struct" || baseType.kind === "function_block" ? lw.layouts.get(baseType.name.toUpperCase()) : undefined
    if (layout === undefined) lw.bail("layout-base", `the base type ${name} of ${t.name} has no layout`, sym?.span ?? ZERO_SPAN)
    else nested.inherit(layout.fields)
  }
  const ast = sym?.ast
  if (t.kind === "struct" && ast?.kind === "type_decl" && ast.body.kind === "struct") {
    base(ast.body.extends?.text)
    declareVars(nested, [{ sectionKind: "VAR", decls: ast.body.fields } as unknown as VarSection])
  } else if (t.kind === "function_block" && (ast?.kind === "function_block" || ast?.kind === "program")) {
    // The compiler acts on these whether or not the FB is ever called, and `lowerUnit`'s init step models them: an
    // `instance-path` STRING holds the instance's path from the project tree, and a `call_after_global_init_slot` method
    // runs once per instance before the first scan; `call_after_init`'s and `call_after_online_change_slot`'s did not run
    // at all in a started application (measured).
    base(baseOf(ast)?.text)
    declareVars(nested, ast.varSections.filter((s) => INSTANCE_STORAGE.has(s.sectionKind)))
    lw.bodies.set(t.name.toUpperCase(), { lowering: nested, unit: ast, state: "pending" })
  } else {
    lw.bail(`layout-${t.kind}`, `${t.name} has no declaration lowering can lay out`, sym?.span ?? ZERO_SPAN)
    return
  }
  lw.diagnostics.push(...nested.diagnostics)
  // the live frame: temps the FB's body adds when a call lowers it are fields of the instance too
  lw.layouts.set(t.name.toUpperCase(), { name: t.name, kind: t.kind, fields: nested.frame })
}

export function declareVars(lw: Lowering, sections: readonly VarSection[]): void {
  // a VAR_EXTERNAL declares no storage: its name is the global's (`globalPlace`) — a slot here would be a local copy
  for (const sec of sections.filter((s) => s.sectionKind !== "VAR_EXTERNAL"))
    for (const written of sec.decls) {
      const type = storageOf(lw, lw.resolve(written.type))
      // A variable with no initializer of its own starts at its ALIAS type's: `TYPE T : INT := 42;` makes `x : T` 42
      // (conformance `type_dut_alias_with_init`, 43 after `x := x + 1`). It started at 0 — `resolve` sees through the
      // alias to INT and the alias's initializer went with it.
      const decl = { ...written, init: written.init ?? aliasInit(lw, written.type) }
      const init = decl.init === undefined ? undefined : decl.init.kind === "aggregate_init" ? aggregateInit(lw, decl.init, type) : scalarInit(lw, decl.init, type)
      if (decl.init !== undefined && init === undefined) continue
      for (const name of decl.names) lw.slot(name, type, sec.sectionKind, init)
    }
}

/**
 * A scalar initial value, folded and stored at the slot's type — undefined, reported, when it does not fold.
 * The folded value takes the SLOT's type: `x : REAL := 7 / 2` folds to the integer 3 and is stored as REAL 3 (left as-is,
 * a REAL slot started life holding a bigint). `constEval` folds only numbers and booleans — a duration or date literal
 * came back undefined, so every `t : TIME := T#1S` slot silently started at 0: they fold here, in their type's unit. Nor
 * does it fold strings: every `s : STRING := 'abc'` started empty (conformance `string_*`). An initializer that does not
 * fold is REPORTED — it used to be dropped, so the slot silently started at its default.
 */
function scalarInit(lw: Lowering, e: Expr, type: Type): IrValue | undefined {
  const temporal = e.kind === "literal" ? (durationOf(e) ?? calendarOf(e) ?? typedRealOf(e)) : undefined
  const text = e.kind === "literal" && typeof e.value === "string" ? stringLiteralText(lw, e) : undefined
  if (text === null) return undefined
  const folded = temporal?.value ?? text ?? foldConstant(lw, e)
  if (folded === undefined) return lw.bail("init-not-constant", "an initial value that is not a compile-time constant", e.span)
  return stored(valueAs(folded, type), type)
}

/**
 * An aggregate initializer as the initial value it is (conformance `array_initializers`, `init_struct_by_field`,
 * `init_array_of_structs`, `init_fb_instance_inputs`): an array's elements in order — `n(v)` repeated, a
 * multi-dimensional array filled row by row, every element left out at its type's own initial value; a struct's or FB
 * instance's fields by name, every field left out at its TYPE's initial value. `STRUCT(…)` is `(…)`. Any other shape — a
 * positional element in a struct form, more elements than the array holds, an unparsed element — is refused.
 */
function aggregateInit(lw: Lowering, init: AggregateInit, type: Type): IrInit | undefined {
  const refuse = (why: string): undefined => lw.bail("aggregate-init", `an aggregate initializer ${why}`, init.span)
  const element = (e: AggregateElement, of: Type): IrInit | undefined =>
    e.kind === "value" ? scalarInit(lw, e.expr, of) : e.kind === "nested" ? aggregateInit(lw, e.init, of) : refuse(`with a ${e.kind} element where a value belongs`)
  if (init.form === "array") {
    if (type.kind !== "array" || type.bounds === undefined) return refuse("in array form for something that is not a sized array")
    const leaves: AggregateElement[] = []
    for (const e of init.elements) {
      if (e.kind !== "repeat") {
        leaves.push(e)
        continue
      }
      const count = foldConstant(lw, e.count)
      if (typeof count !== "bigint" || count < 0n) return refuse("with a repeat count that does not fold")
      for (let i = 0n; i < count; i++) leaves.push(e.value)
    }
    // every dimension of this one array type, row by row; an ARRAY OF ARRAY's element takes a nested `[…]` of its own
    const lengths = type.bounds.map((b) => Number(b.upper - b.lower + 1n))
    if (leaves.length > lengths.reduce((n, length) => n * length, 1)) return refuse("with more elements than the array holds")
    const values: (IrInit | undefined)[] = []
    for (const leaf of leaves) {
      const value = element(leaf, type.element)
      if (value === undefined) return undefined
      values.push(value)
    }
    const nest = (level: number, offset: number): IrInit | undefined => {
      if (level === lengths.length) return values[offset]
      const stride = lengths.slice(level + 1).reduce((n, length) => n * length, 1)
      return { elements: Array.from({ length: lengths[level]! }, (_, i) => nest(level + 1, offset + i * stride)) }
    }
    return nest(0, 0)
  }
  if (init.form === "struct") {
    const layout = type.kind === "struct" || type.kind === "function_block" ? lw.layouts.get(type.name.toUpperCase()) : undefined
    if (layout === undefined) return refuse("in struct form for something that is not a struct or FB instance")
    const fields: Record<string, IrInit> = {}
    for (const e of init.elements) {
      if (e.kind !== "field") return refuse("with an element that names no field")
      const field = layout.fields.find((f) => f.name.toUpperCase() === e.name.toUpperCase())
      if (field === undefined) return refuse(`naming ${e.name}, which is no field of ${layout.name}`)
      const value = element(e.value, field.type)
      if (value === undefined) return undefined
      fields[field.name.toUpperCase()] = value
    }
    return { fields }
  }
  return refuse("of a shape lowering does not recognise")
}

/** An FB body's VAR_IN_OUT parameters — not storage: each names the caller's variable for the call. */
export function declareInOuts(lw: Lowering, sections: readonly VarSection[]): void {
  for (const sec of sections)
    for (const decl of sec.decls) {
      const type = storageOf(lw, lw.resolve(decl.type))
      for (const name of decl.names) {
        lw.inoutByName.set(name.text.toUpperCase(), lw.inoutSlots.length)
        lw.inoutSlots.push({ name: name.text, type, section: "VAR_IN_OUT", init: defaultValueOf(type) })
      }
    }
}

/** The initializer the variable's alias type carries. ponytail: an alias OF an alias is unmeasured, so only the
 *  direct alias's own `:=` is taken — measure a chain before walking it. */
export function aliasInit(lw: Lowering, t: TypeExpr): Initializer | undefined {
  if (t.kind !== "named_type") return undefined
  const sym = lookup(lw.scope, t.name.text)?.symbol
  const body = sym?.kind === "type" ? (sym.ast as TypeDecl).body : undefined
  return body?.kind === "alias" ? body.init : undefined
}
