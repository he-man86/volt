/**
 * THE BARE-NAME SEARCH ORDER — what a bare identifier names, in the order CODESYS searches (rule Y23,
 * `docs/codesys-reference/09-shadowing.md`): the one home of the question. The analysis words what it answers (an
 * undefined name, `analysis/resolution.ts`); the binder supplies what it searches (`symbols/`); nothing else decides it.
 *
 *   the compiler's own names   a system operator, a conversion, a compiler implicit, an operator or standard function,
 *                              an elementary type (`builtins.ts` `builtinName`) — none can be declared over: the
 *                              vendor refuses the declaration (`calc : INT;` is a parse cascade on CODESYS,
 *                              `cc_il_name_calc`), so the built-in is the answer before any declaration is looked up;
 *   a declaration              steps 1–10 in `symbols/scope-nav` `lookup`: the locals, the POU's variables and its
 *                              bases', its methods, then the project's level — globals before POU and type names, the
 *                              application's before a library's (`projectLevelHit`); a device-tree instance (Y24) and a
 *                              library namespace (step 11) answer there too, each tagged;
 *   an enum member             a bare member of an enum that is not `qualified_only`, the asker's own enums before a
 *                              referenced library's (rules EN1, EN2, EN6), after every declaration; one that TWO such
 *                              enums declare is AMBIGUOUS (EN3) — it names nothing, "Identifier not defined", and among
 *                              the asker's own enums the vendors say "Ambiguous use of name" too (`symbols/scope-nav`
 *                              `resolveBareEnumMember`).
 *
 * In `types/` because one step asks about built-in TYPE names (design.md "Why no member resolution in symbols").
 */
import { isLibrarySymbol, lookup, lookupGlobal, resolveBareEnumMember, rootOf, type Scope, type Symbol } from "../symbols/index.js"
import { builtinName, type BuiltinName } from "./builtins.js"

/** What a bare name names. */
export type BareName =
  | { kind: "declared"; symbol: Symbol; foundIn: Scope }
  | { kind: "device"; symbol: Symbol }
  | { kind: "library-namespace"; symbol: Symbol }
  | { kind: "enum-member"; symbol: Symbol }
  | { kind: "ambiguous"; candidates: readonly Symbol[]; said: boolean }
  | { kind: "builtin"; builtin: BuiltinName }
  | { kind: "none" }

const NONE: BareName = { kind: "none" }

/** What the bare name `name`, written in `scope`, names (rule Y23). */
export function resolveBareName(scope: Scope, name: string): BareName {
  const project = rootOf(scope)
  const builtin = builtinName(name, project.dialect)
  if (builtin !== undefined) return { kind: "builtin", builtin }
  const found = lookup(scope, name)
  if (found !== undefined) return tagged(found.symbol, found.foundIn)
  const member = resolveBareEnumMember(scope, name)
  if (member === undefined) return NONE
  return member.kind === "member" ? { kind: "enum-member", symbol: member.symbol } : { kind: "ambiguous", candidates: member.candidates, said: member.said }
}

/**
 * What `.name` names — the GLOBAL namespace's `name`, every local and member passed over (rule E33): the project's level
 * of the search order alone, and nothing where two of the project's lists declare it (`symbols/scope-nav` `lookupGlobal`).
 */
export function resolveGlobalName(project: Scope, name: string): BareName {
  const symbol = lookupGlobal(project, name)
  return symbol === undefined ? NONE : tagged(symbol, project)
}

function tagged(symbol: Symbol, foundIn: Scope): BareName {
  if (symbol.kind === "device") return { kind: "device", symbol }
  // a library's namespace is bound from its manifest, which sits in the library's folder (a source NAMESPACE block is a
  // declaration of the file that holds it)
  if (symbol.kind === "namespace" && isLibrarySymbol(symbol)) return { kind: "library-namespace", symbol }
  return { kind: "declared", symbol, foundIn }
}
