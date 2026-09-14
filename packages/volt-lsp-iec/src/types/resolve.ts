/**
 * resolve — a declared `TypeExpr` → the rich `Type` (Layer C, C.2). Walks the project symbol table,
 * follows aliases, embeds elementary facts, and carries member scopes. Conservative: any step that
 * fails (name not in scope, library type, cycle) yields `UNKNOWN` — callers skip, never false-positive.
 */
import type { Scope } from "../symbols/index.js"
import { findChildScope, isLibrarySymbol, lookupLocal } from "../symbols/index.js"
import type { Span, TypeDecl, TypeExpr } from "../syntax/index.js"
import { constEval } from "./const-eval.js"
import { elementaryType } from "./elementary.js"
import { elementaryRef, elementaryTypeRef, UNKNOWN, type Type } from "./type.js"

const MAX_ALIAS_DEPTH = 10

/** Resolve a full TypeExpr to a rich Type. */
export function resolveTypeExpr(t: TypeExpr, project: Scope, depth = 0): Type {
  if (depth > MAX_ALIAS_DEPTH) return UNKNOWN
  switch (t.kind) {
    case "named_type":
      return resolveNamedType(t.name.text, project, depth)
    case "string_type": {
      // Carry a declared capacity (`STRING(5)`); a length this scope cannot fold leaves it unstated, never guessed.
      const base = elementaryRef(t.wide ? "WSTRING" : "STRING")
      const length = t.length === undefined ? undefined : constEval(t.length, project)
      return base.kind === "elementary" && typeof length === "bigint" ? { ...base, length: Number(length) } : base
    }
    case "implicit_enum_type":
      // Inline enum: its values live as bare constants in the enclosing scope, so no member scope here.
      return { kind: "enum", name: "(implicit)" }
    case "array_type": {
      const element = resolveTypeExpr(t.element, project, depth + 1)
      const bounds = t.dims.map((d) => {
        const lower = d.lower === undefined ? undefined : constEval(d.lower, project)
        const upper = d.upper === undefined ? undefined : constEval(d.upper, project)
        return typeof lower === "bigint" && typeof upper === "bigint" ? { lower, upper } : undefined
      })
      return bounds.every((b) => b !== undefined)
        ? { kind: "array", element, dims: t.dims, bounds: bounds as { lower: bigint; upper: bigint }[] }
        : { kind: "array", element, dims: t.dims }
    }
    case "pointer_type":
      return { kind: "pointer", target: resolveTypeExpr(t.target, project, depth + 1) }
    case "reference_type":
      return { kind: "reference", target: resolveTypeExpr(t.target, project, depth + 1) }
  }
}

/**
 * The inverse of `resolveTypeExpr`: a TypeExpr that resolves back to exactly `t`, placed at `span` — for a type that
 * has no declaration of its own, like a network wire inferred from its producer. It lived in the network analysis as
 * `synthTypeExpr`, which once emitted a bare name only: a string's length and an array, pointer or reference wire's
 * structure were lost (consolidate-lsp-structure A11). An interface or unknown type has no TypeExpr here.
 */
export function typeToTypeExpr(t: Type, span: Span): TypeExpr | undefined {
  const named = (text: string): TypeExpr => ({ kind: "named_type", name: { kind: "identifier", text, span }, span })
  switch (t.kind) {
    case "elementary":
      if (t.elem.family !== "string" || t.length === undefined) return named(t.name)
      return {
        kind: "string_type",
        wide: t.name === "WSTRING",
        length: { kind: "literal", literalKind: "int", text: String(t.length), value: BigInt(t.length), span },
        span,
      }
    case "enum":
    case "struct":
    case "function_block":
      return named(t.name)
    case "array": {
      const element = typeToTypeExpr(t.element, span)
      return element === undefined ? undefined : { kind: "array_type", dims: [...t.dims], element, span }
    }
    case "pointer":
    case "reference": {
      const target = typeToTypeExpr(t.target, span)
      if (target === undefined) return undefined
      return t.kind === "pointer" ? { kind: "pointer_type", target, span } : { kind: "reference_type", target, span }
    }
    default:
      return undefined
  }
}

/** Resolve a bare type name (elementary built-in, or a project-declared FB/enum/struct/alias). */
export function resolveNamedType(name: string, project: Scope, depth = 0): Type {
  const elem = elementaryType(name)
  if (elem !== undefined) return elementaryTypeRef(elem)

  const syms = lookupLocal(project, name)
  if (syms.length === 0) return UNKNOWN
  const sym = syms[0]

  if (sym.kind === "function_block" || sym.kind === "program") {
    return { kind: "function_block", name, scope: findChildScope(project, name) }
  }
  if (sym.kind === "interface") {
    return { kind: "interface", name, scope: findChildScope(project, name) }
  }
  if (sym.kind === "type") {
    const body = (sym.ast as TypeDecl).body
    if (body.kind === "enum") {
      const scope = findChildScope(project, name)
      // A project enum with no base type written converts as INT (conformance `cc_enum_into_*`, `cc_enum_var_into_*`). A
      // written base type is unmeasured, and so is a LIBRARY enum: two real builds (bakon-nano, pro2193) store one into a
      // WORD with no warning — both stay without a base, so they convert as before.
      const measured = body.baseType === undefined && !isLibrarySymbol(sym)
      return measured ? { kind: "enum", name, scope, base: elementaryTypeRef(elementaryType("INT")!) } : { kind: "enum", name, scope }
    }
    if (body.kind === "struct" || body.kind === "union") {
      return { kind: "struct", name, scope: findChildScope(project, name) }
    }
    if (body.kind === "alias") return resolveTypeExpr(body.target, project, depth + 1)
  }
  return UNKNOWN
}
