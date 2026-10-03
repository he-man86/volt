/**
 * resolve — a declared `TypeExpr` → the rich `Type` (Layer C, C.2). Walks the project symbol table,
 * follows aliases, embeds elementary facts, and carries member scopes. Conservative: any step that
 * fails (name not in scope, library type, cycle) yields `UNKNOWN` — callers skip, never false-positive.
 */
import {
  childScopesByName,
  findChildScope,
  isLibrarySymbol,
  lookupLocal,
  pickForAsker,
  scopeUri,
  targetOf,
  type Scope,
  type Symbol,
} from "../symbols/index.js"
import { exprText, type Dialect, type TypeDecl, type TypeExpr } from "../syntax/index.js"
import { constEval } from "./const/fold.js"
import { CODESYS_ONLY_TYPES } from "./elementary.js"
import { elementaryTypeOn } from "./platform.js"
import { elementaryRef, elementaryTypeRef, UNKNOWN, type Type } from "./type.js"
import { enumBase } from "./enums.js"
import { systemStructType } from "./system.js"

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
      if ((t.qualifiers?.length ?? 0) > 0) return resolveQualifiedType(t.qualifiers!.map((q) => q.text), t.name.text, project, depth, askerUri)
      return withSubrange(resolveNamedType(t.name.text, project, depth, askerUri), t, valueScope)
    case "string_type": {
      // Carry a declared capacity (`STRING(5)`); a length this scope cannot fold leaves it unstated, never guessed.
      const base = elementaryRef(t.wide ? "WSTRING" : "STRING")
      const length = t.length === undefined ? undefined : constEval(t.length, valueScope)
      if (base.kind !== "elementary" || t.length === undefined) return base
      if (typeof length !== "bigint") return { ...base, unfoldedLength: true }
      return t.length.kind === "literal" ? { ...base, length: Number(length) } : { ...base, length: Number(length), lengthText: exprText(t.length) }
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

/** A subrange's bounds on the integer type it narrows (`INT(0..10)`), folded where it is declared — rule DT3. A bound that
 *  does not fold leaves the base alone: no guessed range. */
function withSubrange(base: Type, t: Extract<TypeExpr, { kind: "named_type" }>, valueScope: Scope): Type {
  if (t.subrange === undefined || base.kind !== "elementary") return base
  const lower = constEval(t.subrange.lo, valueScope)
  const upper = constEval(t.subrange.hi, valueScope)
  return typeof lower === "bigint" && typeof upper === "bigint" ? { ...base, subrange: { lower, upper } } : base
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
  // `CODESYS_ONLY_TYPES`), and on TwinCAT the name reaches the symbol lookup like any other unknown one. A platform
  // integer is the project's TARGET's width (`platform.ts`); on an unknown target it is no type this can name, and no
  // symbol declares it either, so it is UNKNOWN — silent, never a guessed width (frontend-conformance 4.1.1).
  const elem = isDialectType(name, project.dialect) ? elementaryTypeOn(name, targetOf(project)) : undefined
  if (elem !== undefined) return elementaryTypeRef(elem)

  // KIND FIRST, THEN WHO IS ASKING. A name can be held by something that is not a type at all — every
  // referenced library defines a NAMESPACE symbol named after its manifest, and `SysTime` (the library) sits
  // on the same name as `SYSTIME` (the alias `TYPE SYSTIME : ULINT` in SysTimeCore). Ranking by library
  // visibility alone preferred the namespace, because the asking library DEPENDS ON SysTime and not on
  // SysTimeCore — and a namespace has no type to return, so `RESETTIME : SYSTIME` became an unknown slot and
  // a real POU stopped lowering. Precedence decides between candidates that could ANSWER the question; it
  // does not get to decide what the question is.
  const syms = lookupLocal(project, name).filter((x) => TYPE_SYMBOL_KINDS.has(x.kind))
  // …and a name no symbol holds may be the COMPILER's own struct: VERSION, or the AnyType of an ANY input (`system.ts`)
  if (syms.length === 0) return systemStructType(name) ?? UNKNOWN
  return typeOfSymbol(pickForAsker(project, syms, (x) => x.uri, askerUri)!, name, project, depth, askerUri)
}

/**
 * The namespace scope a qualifier chain names (rules LB1, LB8): `Ns` a referenced library's namespace (or a source
 * NAMESPACE block), then each further name a namespace THAT one holds — the namespace symbol of a library it depends on
 * (`DED.CommFB`, measured: `DED.CommFB.IO_SYSTEM_TYPE` builds and is CommFB's enum, `lib_ns_transitive_qualification`).
 * Undefined when a name of the chain is no namespace there.
 */
export function namespaceOf(qualifiers: readonly string[], project: Scope, askerUri: string | undefined): Scope | undefined {
  const [first, ...rest] = qualifiers
  if (first === undefined) return undefined
  let ns = findChildScope(project, first, askerUri)
  for (const q of rest) {
    if (ns?.kind !== "namespace") return undefined
    const held = lookupLocal(ns, q).find((x) => x.kind === "namespace")
    ns = held === undefined ? undefined : childScopesByName(project, held.name).find((c) => c.kind === "namespace")
  }
  return ns?.kind === "namespace" ? ns : undefined
}

/**
 * `Ns.T` — the type `T` of the namespace the qualifiers name, its library's own before a dependency's (rule LB3: `DED.ERROR`
 * is CAA Device Diagnosis', not CAA Types'). The qualifier was dropped here and `T` resolved bare, so `Util.ERROR` was
 * whichever ERROR sorted first — CAA Device Diagnosis' (`lib_ns_type_qualified` holds Util's WRONG_CONFIGURATION,
 * CODESYS 2026-10-02).
 *
 * <p>A NAMESPACE THAT DOES NOT HOLD `T` AS MATERIALIZED is not a namespace without it, and `T` is then the name as the
 * project holds it. Measured over the corpora (2026-10-02): 130 library references in pro2193 alone name a type their
 * namespace's folder does not hold — an interface library materialized under `(unresolved)/`
 * (`IIoDrvProfibus.DP_StationStatus1`), an element of a dependency the library publishes, an element not materialized
 * at all (`STU.DateFormatter`) — and every one builds. Which of those the vendor would refuse is what the manifest does
 * not carry (rule LB2). Every one of them is a LIBRARY's element, so only a library's answers: `Util.AppStruct`, an
 * APPLICATION type behind a library's namespace, is UNKNOWN (unrecorded; it had resolved silently to the project's type).
 * The compiler's own `__SYSTEM` namespace holds compiler names, read bare.
 * A qualifier naming nothing (`NoSuchLib.T`) is UNKNOWN — "Unknown type" (`analysis/resolution` `unknownQualifiedTypeName`).</p>
 */
function resolveQualifiedType(qualifiers: readonly string[], name: string, project: Scope, depth: number, askerUri: string | undefined): Type {
  if (qualifiers[0]!.startsWith("__")) return resolveNamedType(name, project, depth, askerUri)
  const ns = namespaceOf(qualifiers, project, askerUri)
  if (ns === undefined) return UNKNOWN
  const syms = lookupLocal(ns, name).filter((x) => TYPE_SYMBOL_KINDS.has(x.kind))
  if (syms.length > 0) return typeOfSymbol(pickForAsker(project, syms, (x) => x.uri, ns.libraryUri ?? askerUri)!, name, project, depth, askerUri)
  // only a LIBRARY's element: each of the 130 is one, and a library namespace holds no application type
  const elsewhere = lookupLocal(project, name).filter((x) => TYPE_SYMBOL_KINDS.has(x.kind) && isLibrarySymbol(x))
  if (elsewhere.length === 0) return UNKNOWN
  return typeOfSymbol(pickForAsker(project, elsewhere, (x) => x.uri, ns.libraryUri ?? askerUri)!, name, project, depth, askerUri)
}

/** The Type a POU, interface or type symbol `sym` (named `name`) stands for. */
function typeOfSymbol(sym: Symbol, name: string, project: Scope, depth: number, from: string | undefined): Type {

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
      // the base it converts as is `enums.ts`'s rule
      const base = enumBase(body, sym)
      return base !== undefined ? { kind: "enum", name, scope, base } : { kind: "enum", name, scope }
    }
    if (body.kind === "struct") return { kind: "struct", name, scope: ownScope() }
    if (body.kind === "union") return { kind: "struct", name, scope: ownScope(), union: true }
    // An alias resolves IN ITS OWN FILE: `TYPE T : ETRIG; END_TYPE` inside a library means that library's
    // ETRIG, whoever is reading the alias.
    if (body.kind === "alias") return resolveTypeExpr(body.target, project, depth + 1, project, sym.uri)
  }
  return UNKNOWN
}

/**
 * Is `name` a type in `dialect`'s vocabulary? Every name is but the 64-bit date types on TwinCAT, which has `LTIME` and
 * does NOT have `LDATE`, `LTOD`/`LTIME_OF_DAY` or `LDT`/`LDATE_AND_TIME` (`elementary.ts` `CODESYS_ONLY_TYPES`). The
 * one copy of that gate: resolution and the conversion names ask here; the parser's refused type names read the same list
 * (`syntax/lex/vocabulary.ts` `CODESYS_ONLY_TYPE_WORDS`, `isRefusedWord`).
 */
export function isDialectType(name: string, dialect: Dialect | undefined): boolean {
  return !(dialect === "twincat" && CODESYS_ONLY_TYPES.has(name.toUpperCase()))
}
