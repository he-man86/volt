/**
 * resolve — a declared `TypeExpr` → the rich `Type` (Layer C, C.2). Walks the project symbol table,
 * follows aliases, embeds elementary facts, and carries member scopes. Conservative: any step that
 * fails (name not in scope, library type, cycle) yields `UNKNOWN` — callers skip, never false-positive.
 */
import type { Scope } from "../symbols/index.js"
import { pickForAsker, scopeUri } from "../symbols/precedence.js"
import { childScopesByName, findChildScope, isLibrarySymbol, lookupLocal } from "../symbols/index.js"
import type { Span, TypeDecl, TypeExpr } from "../syntax/index.js"
import { constEval } from "./const-eval.js"
import { CODESYS_ONLY_TYPES, elementaryType } from "./elementary.js"
import { elementaryRef, elementaryTypeRef, UNKNOWN, type Type } from "./type.js"

const MAX_ALIAS_DEPTH = 10

/**
 * Resolve a full TypeExpr to a rich Type. `valueScope` is where a bound or a string capacity folds — the declaring POU's
 * scope, so `ARRAY[1..count]` with `count` its own VAR CONSTANT folds (pro2193 `ARRAY[1..numberOfXYControls]` was "not a
 * sized array"); it defaults to the project scope, where only a GVL constant is seen.
 */
export function resolveTypeExpr(
  t: TypeExpr,
  project: Scope,
  depth = 0,
  valueScope: Scope = project,
  // WHO IS ASKING — the file the type name was written in. It decides the answer when a name has more than
  // one candidate, which happens whenever a project references two libraries exporting the same element
  // (symbols/precedence.ts). It defaults off `valueScope`, so a caller that already says where the
  // expression lives gets asker-aware resolution for free; a caller holding only a Symbol passes its `uri`.
  askerUri: string | undefined = scopeUri(valueScope),
): Type {
  if (depth > MAX_ALIAS_DEPTH) return UNKNOWN
  switch (t.kind) {
    case "named_type":
      // valueScope is WHO IS ASKING, and it decides the answer when a name has more than one candidate —
      // two referenced libraries exporting the same element (see symbols/precedence.ts). It was dropped here
      // while every other arm threaded it, so the one lookup that can be ambiguous was the one without it.
      return resolveNamedType(t.name.text, project, depth, askerUri)
    case "string_type": {
      // Carry a declared capacity (`STRING(5)`); a length this scope cannot fold leaves it unstated, never guessed.
      const base = elementaryRef(t.wide ? "WSTRING" : "STRING")
      const length = t.length === undefined ? undefined : constEval(t.length, valueScope)
      return base.kind === "elementary" && typeof length === "bigint" ? { ...base, length: Number(length) } : base
    }
    case "implicit_enum_type":
      // Inline enum: its values live as bare constants in the enclosing scope, so no member scope here.
      return { kind: "enum", name: "(implicit)" }
    case "array_type": {
      const element = resolveTypeExpr(t.element, project, depth + 1, valueScope, askerUri)
      const bounds = t.dims.map((d) => {
        const lower = d.lower === undefined ? undefined : constEval(d.lower, valueScope)
        const upper = d.upper === undefined ? undefined : constEval(d.upper, valueScope)
        return typeof lower === "bigint" && typeof upper === "bigint" ? { lower, upper } : undefined
      })
      return bounds.every((b) => b !== undefined)
        ? { kind: "array", element, dims: t.dims, bounds: bounds as { lower: bigint; upper: bigint }[] }
        : { kind: "array", element, dims: t.dims }
    }
    case "pointer_type":
      return { kind: "pointer", target: resolveTypeExpr(t.target, project, depth + 1, valueScope, askerUri) }
    case "reference_type":
      return { kind: "reference", target: resolveTypeExpr(t.target, project, depth + 1, valueScope, askerUri) }
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

/** The symbol kinds that can answer "what type is this name?" — everything else on the name is not a type. */
const TYPE_SYMBOL_KINDS: ReadonlySet<string> = new Set(["function_block", "program", "interface", "type"])

/** The child scope belonging to a particular declaration, by its file — falling back to the name when that
 *  file declares no scope of its own (an alias has none). */
function scopeOf(project: Scope, name: string, uri: string | undefined, askerUri: string | undefined) {
  const byName = childScopesByName(project, name)
  return byName.find((c) => c.defUri === uri) ?? findChildScope(project, name, askerUri)
}

/**
 * Resolve a bare type name (elementary built-in, or a project-declared FB/enum/struct/alias).
 *
 * `askerUri` is the file the name was written in. When several top-level things share the name — which
 * happens whenever a project references two libraries that export the same element — it is what tells them
 * apart: the asker's own library first, then one it depends on. See `symbols/precedence.ts`.
 */
export function resolveNamedType(
  name: string,
  project: Scope,
  depth = 0,
  askerUri: string | undefined = undefined,
): Type {
  // …unless the project's dialect does not have it: `LDATE`/`LTOD`/`LDT` are CODESYS's (see
  // `CODESYS_ONLY_TYPES`), and on TwinCAT the name reaches the symbol lookup like any other unknown one.
  const elem = project.dialect === "twincat" && CODESYS_ONLY_TYPES.has(name.toUpperCase()) ? undefined : elementaryType(name)
  if (elem !== undefined) return elementaryTypeRef(elem)

  // KIND FIRST, THEN WHO IS ASKING. A name can be held by something that is not a type at all — every
  // referenced library defines a NAMESPACE symbol named after its manifest, and `SysTime` (the library) sits
  // on the same name as `SYSTIME` (the alias `TYPE SYSTIME : ULINT` in SysTimeCore). Ranking by library
  // visibility alone preferred the namespace, because the asking library DEPENDS ON SysTime and not on
  // SysTimeCore — and a namespace has no type to return, so `RESETTIME : SYSTIME` became an unknown slot and
  // a real POU stopped lowering. Precedence decides between candidates that could ANSWER the question; it
  // does not get to decide what the question is.
  const syms = lookupLocal(project, name).filter((x) => TYPE_SYMBOL_KINDS.has(x.kind))
  if (syms.length === 0) return UNKNOWN
  const from = askerUri
  const sym = pickForAsker(project, syms, (x) => x.uri, from)!

  // The scope of THE SYMBOL CHOSEN, not of the name — with two candidates they are different scopes, and
  // handing back the other one's members is the same bug wearing a different hat.
  const ownScope = (): Scope | undefined => scopeOf(project, name, sym.uri, from)

  if (sym.kind === "function_block" || sym.kind === "program") {
    return { kind: "function_block", name, scope: ownScope() }
  }
  if (sym.kind === "interface") {
    return { kind: "interface", name, scope: ownScope() }
  }
  if (sym.kind === "type") {
    const body = (sym.ast as TypeDecl).body
    if (body.kind === "enum") {
      const scope = ownScope()
      // A project enum with no base type written converts as INT (conformance `cc_enum_into_*`, `cc_enum_var_into_*`). A
      // written base type is unmeasured, and so is a LIBRARY enum: two real builds (bakon-nano, pro2193) store one into a
      // WORD with no warning — both stay without a base, so they convert as before.
      const measured = body.baseType === undefined && !isLibrarySymbol(sym)
      return measured ? { kind: "enum", name, scope, base: elementaryTypeRef(elementaryType("INT")!) } : { kind: "enum", name, scope }
    }
    if (body.kind === "struct" || body.kind === "union") {
      return { kind: "struct", name, scope: ownScope() }
    }
    // An alias resolves IN ITS OWN FILE: `TYPE T : ETRIG; END_TYPE` inside a library means that library's
    // ETRIG, whoever is reading the alias.
    if (body.kind === "alias") return resolveTypeExpr(body.target, project, depth + 1, project, sym.uri)
  }
  return UNKNOWN
}
