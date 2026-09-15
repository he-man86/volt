/**
 * What a variable is stored as: a type's storage and its layout, and the declarations that make a frame's slots.
 */
import type { Initializer, TypeDecl, TypeExpr, VarSection } from "../../syntax/index.js"
import { lookup } from "../../symbols/index.js"
import { DEFAULT_STRING_LENGTH, resolveNamedType, type Type } from "../../types/index.js"
import { defaultValueOf } from "../ir/index.js"
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
      if (decl.init?.kind === "aggregate_init") {
        lw.bail("aggregate-init", "an aggregate initializer is not lowered yet", decl.init.span)
        continue
      }
      // The folded value takes the SLOT's type: `x : REAL := 7 / 2` folds to the integer 3 and is stored as REAL 3.
      // Left as-is, a REAL slot started life holding a bigint.
      // `constEval` folds only numbers and booleans — a duration or date literal came back undefined, so every
      // `t : TIME := T#1S` / `d : DATE := D#…` slot silently started at 0. They fold here, in their type's unit.
      const temporal = decl.init?.kind === "literal" ? (durationOf(decl.init) ?? calendarOf(decl.init) ?? typedRealOf(decl.init)) : undefined
      // `constEval` does not fold strings either: every `s : STRING := 'abc'` started empty (conformance `string_*`).
      const text = decl.init?.kind === "literal" && typeof decl.init.value === "string" ? stringLiteralText(lw, decl.init) : undefined
      if (text === null) continue
      const folded = temporal?.value ?? text ?? (decl.init === undefined ? undefined : foldConstant(lw, decl.init))
      // An initializer that does not fold is REPORTED — it used to be dropped, so the slot silently started at its
      // default. That is how every string slot lost its value without one lowering diagnostic.
      if (decl.init !== undefined && folded === undefined) {
        lw.bail("init-not-constant", "an initial value that is not a compile-time constant", decl.init.span)
        continue
      }
      const init = folded === undefined ? undefined : stored(valueAs(folded, type), type)
      for (const name of decl.names) lw.slot(name, type, sec.sectionKind, init)
    }
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
