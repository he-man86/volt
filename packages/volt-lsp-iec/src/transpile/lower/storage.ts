/**
 * What a variable is stored as: a type's storage and its layout, and the declarations that make a frame's slots.
 */
import type { AggregateElement, AggregateInit, Expr, Initializer, Span, TypeDecl, TypeExpr, VarDecl, VarSection } from "../../syntax/index.js"
import { lookup } from "../../symbols/index.js"
import { DEFAULT_STRING_LENGTH, elementaryRef, resolveNamedType, type Type } from "../../types/index.js"
import { defaultValueOf, elementOf, type IrInit, type IrStmt, type IrValue } from "../ir/index.js"
import { baseOf, boundName, Lowering, openDims, ZERO_SPAN } from "./lowering.js"
import { stored, valueAs } from "./convert.js"
import { calendarOf, durationOf, enumStorage, foldConstant, stringLiteralText, typedRealOf } from "./constants.js"
import { overlayBytes } from "./unions.js"

/** The FB variable sections that are an instance's storage. VAR_IN_OUT is not: it aliases the caller's variable. Nor is
 *  VAR_STAT, shared by every instance (`declareStatics`); VAR_TEMP is, started over on each run (`tempResets`). */
export const INSTANCE_STORAGE: ReadonlySet<string> = new Set(["VAR", "VAR_INPUT", "VAR_OUTPUT", "VAR_TEMP"])

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
  const statics: { name: string; global: number }[] = []
  const base = (name: string | undefined): void => {
    if (name === undefined) return
    const baseType = storageOf(lw, resolveNamedType(name, lw.project))
    const layout = baseType.kind === "struct" || baseType.kind === "function_block" ? lw.layouts.get(baseType.name.toUpperCase()) : undefined
    if (layout === undefined) return void lw.bail("layout-base", `the base type ${name} of ${t.name} has no layout`, sym?.span ?? ZERO_SPAN)
    nested.inherit(layout.fields)
    for (const shared of layout.statics ?? []) {
      nested.statics.set(shared.name.toUpperCase(), shared.global)
      statics.push(shared)
    }
  }
  const ast = sym?.ast
  if (t.kind === "struct" && ast?.kind === "type_decl" && ast.body.kind === "struct") {
    base(ast.body.extends?.text)
    declareVars(nested, [{ sectionKind: "VAR", decls: ast.body.fields } as unknown as VarSection])
  } else if (t.kind === "struct" && ast?.kind === "type_decl" && ast.body.kind === "union") {
    // A struct of its members, kept overlaid by the store (`unions.ts`) — either every member's bytes are measured, or
    // EVERY member is a pointer, which is one integer in this model (design §9 form 1), so the overlay is a plain copy.
    // A union of pointers is how an ANY input's `pValue` is read at the width its `diSize` selects (conformance
    // `state_any_int_pointer_increment`).
    declareVars(nested, [{ sectionKind: "VAR", decls: ast.body.fields } as unknown as VarSection])
    const pointers = nested.frame.length > 0 && nested.frame.every((f) => f.type.kind === "pointer")
    if (ast.body.fields.some((f) => f.init !== undefined) || !(pointers || nested.frame.every((f) => overlayBytes(f.type) !== undefined))) {
      lw.bail("layout-union", `${t.name} has a member whose overlaid bytes are not measured, or an initial value`, sym?.span ?? ZERO_SPAN)
      return
    }
    lw.shared.unions.add(t.name.toUpperCase())
  } else if (t.kind === "function_block" && (ast?.kind === "function_block" || ast?.kind === "program")) {
    // The compiler acts on these whether or not the FB is ever called, and `lowerUnit`'s init step models them: an
    // `instance-path` STRING holds the instance's path from the project tree, and a `call_after_global_init_slot` method
    // runs once per instance before the first scan; `call_after_init`'s and `call_after_online_change_slot`'s did not run
    // at all in a started application (measured).
    base(baseOf(ast)?.text)
    declareVars(nested, ast.varSections.filter((s) => INSTANCE_STORAGE.has(s.sectionKind)))
    // an `ARRAY[*]` in-out's bounds are the instance's: each call stores them, and the body reads them there
    declareOpenBounds(nested, ast.varSections.filter((s) => s.sectionKind === "VAR_IN_OUT"), "VAR")
    for (const section of ast.varSections.filter((s) => s.sectionKind === "VAR_STAT")) declareStatics(lw, nested, t.name, section, statics)
    lw.bodies.set(t.name.toUpperCase(), { lowering: nested, unit: ast, state: "pending" })
  } else {
    lw.bail(`layout-${t.kind}`, `${t.name} has no declaration lowering can lay out`, sym?.span ?? ZERO_SPAN)
    return
  }
  lw.diagnostics.push(...nested.diagnostics)
  // the live frame: temps the FB's body adds when a call lowers it are fields of the instance too
  lw.layouts.set(t.name.toUpperCase(), { name: t.name, kind: t.kind, fields: nested.frame, ...(statics.length > 0 ? { statics } : {}) })
}

/**
 * An FB body's VAR_STAT: ONE variable every instance shares — measured, two instances each counting twice read 4
 * (conformance `life_fb_var_stat_instances`) — so a global named for the FB, as a METHOD's VAR_STAT is named for the
 * method. It was laid out as a field of each instance (review 2026-09-15). The body, its methods and derived FBs reach it
 * by its own name (`Lowering.statics`).
 */
function declareStatics(lw: Lowering, nested: Lowering, fb: string, section: VarSection, statics: { name: string; global: number }[]): void {
  const key = (name: string) => `__${fb}_${name}`.toUpperCase()
  const names = section.decls.flatMap((d) => d.names.map((n) => n.text))
  if (!names.every((n) => lw.shared.globals.byName.has(key(n)))) {
    const global = new Lowering(nested.scope, lw.project, lw.shared)
    global.globalMode = true
    declareVars(global, [{ ...section, decls: section.decls.map((d) => ({ ...d, names: d.names.map((n) => ({ ...n, text: `__${fb}_${n.text}` })) })) }])
    nested.diagnostics.push(...global.diagnostics)
  }
  for (const name of names) {
    const index = lw.shared.globals.byName.get(key(name))
    if (index === undefined) continue
    nested.statics.set(name.toUpperCase(), index)
    statics.push({ name, global: index })
  }
}

/**
 * A body's VAR_TEMP started over at its initial value — the first statements of every run (conformance
 * `life_fb_var_temp_calls`, `life_program_var_temp_runs`: 1 and 6 after two runs, not 2 and 7). A PROGRAM's kept its value
 * across scans, and an FB's was refused as unmeasured (review 2026-09-15). The variables stay slots of the frame; a
 * temp that is not elementary is refused — resetting one is not built.
 */
export function tempResets(lw: Lowering, sections: readonly VarSection[], span: Span): IrStmt[] | undefined {
  const resets: IrStmt[] = []
  for (const decl of sections.filter((s) => s.sectionKind === "VAR_TEMP").flatMap((s) => s.decls))
    for (const name of decl.names) {
      const index = lw.byName.get(name.text.toUpperCase())
      if (index === undefined) continue // refused where it was declared
      const slot = lw.slots[index]!
      if (slot.type.kind !== "elementary") return lw.bail("var-temp-composite", `${name.text} is a ${slot.type.kind} VAR_TEMP — starting it over is not built`, decl.span)
      resets.push({ kind: "assign", target: { slot: index, path: [], type: slot.type, span }, value: { kind: "const", value: slot.init as IrValue, type: slot.type, span }, span })
    }
  return resets
}

export function declareVars(lw: Lowering, sections: readonly VarSection[]): void {
  // a VAR_EXTERNAL declares no storage: its name is the global's (`globalPlace`) — a slot here would be a local copy
  for (const sec of sections.filter((s) => s.sectionKind !== "VAR_EXTERNAL"))
    for (const written of sec.decls) {
      if (written.at !== undefined && !bindAddress(lw, written)) continue
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
 * `AT %I…/%Q…/%M…` (conformance `operand_hw_address_marker`): in the simulator an address is plain storage — nothing drives
 * an input, a marker reads back what was written — so the variable stays an ordinary slot, the process image a transpiled
 * test writes and reads. What plain storage cannot hold is the ALIASING an address brings (review 2026-09-15), so that is
 * refused: two variables whose addresses overlap — under byte addressing and under word addressing alike, as which one
 * the project uses is not read — several names on one address, an incomplete `%I*` (mapped elsewhere), an address in a
 * METHOD or FUNCTION. An FB field's address shared by the FB's several instances is refused once the POU has lowered.
 */
function bindAddress(lw: Lowering, decl: VarDecl): boolean {
  const text = decl.at!.tokens.map((t) => t.text).join("")
  const refuse = (why: string): boolean => {
    lw.bail("var-at", `${decl.names.map((n) => n.text).join(", ")} AT ${text}: ${why}`, decl.span)
    return false
  }
  const m = /^%([IQM])([XBWDL])(\d+)(?:\.(\d+))?$/i.exec(text)
  if (m === null || (m[2]!.toUpperCase() === "X") !== (m[4] !== undefined)) return refuse("an address that is incomplete, or of a shape not modelled")
  if (lw.routineMode) return refuse("an address inside a METHOD or FUNCTION")
  if (decl.names.length > 1) return refuse("several variables on one address")
  const n = Number(m[3])
  const width = { X: 0, B: 1, W: 2, D: 4, L: 8 }[m[2]!.toUpperCase() as "X" | "B" | "W" | "D" | "L"]
  // [byte addressing, word addressing]: `%MW10` is bytes 10–11 under the one and 20–21 under the other; a bit is either
  const bit = n * 8 + Number(m[4] ?? 0)
  const bits: [number, number][] = width === 0 ? [[bit, bit + 1], [bit, bit + 1]] : [[n * 8, (n + width) * 8], [n * width * 8, (n + 1) * width * 8]]
  const area = m[1]!.toUpperCase()
  const clash = lw.shared.addressed.find((x) => x.area === area && x.bits.some(([from, to], mode) => from < bits[mode]![1] && bits[mode]![0] < to))
  if (clash !== undefined) return refuse(`it overlaps ${clash.name}, which plain storage would not alias`)
  lw.shared.addressed.push({ area, bits, name: decl.names[0]!.text, owner: lw.globalMode ? "GLOBAL" : lw.frameContext })
  return true
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
    if (lw.shared.unions.has(layout.name.toUpperCase())) return refuse("of a UNION, which is not measured")
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
        const constant = sec.constant === true ? { constant: true, ...(holdsInstance(lw, type) ? {} : { readOnly: true }) } : {}
        lw.inoutSlots.push({ name: name.text, type, section: "VAR_IN_OUT", init: defaultValueOf(type), ...constant })
      }
    }
}

/**
 * An `ARRAY[*]` VAR_IN_OUT's bounds, two per dimension — hidden slots its caller fills with the bounds of the array it
 * binds: a routine's as inputs, an FB's as fields of the instance (design §26). DINT, as measured
 * (`callshape_array_star_bound_width`: `UPPER_BOUND(values, 1) * 40000` wraps at 70002).
 */
export function declareOpenBounds(lw: Lowering, sections: readonly VarSection[], section: "VAR_INPUT" | "VAR"): void {
  for (const decl of sections.flatMap((s) => s.decls))
    for (const name of decl.names)
      for (let dim = 1; dim <= openDims(lw.resolve(decl.type)); dim++)
        for (const which of ["lower", "upper"] as const) lw.slot({ kind: "identifier", text: boundName(name.text, which, dim), span: name.span }, elementaryRef("DINT"), section)
}

/** Whether a value of `t` holds an FB instance — it is one, or an element or a field at any depth is. */
export function holdsInstance(lw: Lowering, t: Type): boolean {
  // an `ARRAY[*]` of instances holds them too
  const element = elementOf(t)
  if (element !== undefined) return holdsInstance(lw, element)
  if (t.kind === "function_block") return true
  return t.kind === "struct" && (lw.layouts.get(t.name.toUpperCase())?.fields ?? []).some((f) => holdsInstance(lw, f.type))
}

/** The initializer the variable's alias type carries. ponytail: an alias OF an alias is unmeasured, so only the
 *  direct alias's own `:=` is taken — measure a chain before walking it. */
export function aliasInit(lw: Lowering, t: TypeExpr): Initializer | undefined {
  if (t.kind !== "named_type") return undefined
  const sym = lookup(lw.scope, t.name.text)?.symbol
  const body = sym?.kind === "type" ? (sym.ast as TypeDecl).body : undefined
  return body?.kind === "alias" ? body.init : undefined
}
