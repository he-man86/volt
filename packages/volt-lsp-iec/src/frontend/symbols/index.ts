/**
 * SYMBOLS — the project's scope tree: what a name declares and where it can be reached (openspec frontend-conformance
 * design.md §2 "Index contents"). The read API is named here one by one; building the table — whole, or one file at a
 * time as the live server does — is the `build` namespace, so a reader and a builder cannot be told apart by accident.
 * Consumers import this file, never one beside it.
 */
import { bindFile, buildSymbolTable, relink, unbindFile } from "./incremental.js"
import { localScope } from "./scope.js"

// the model
export {
  isPouSymbol,
  POU_SYMBOL_KINDS,
  type DeviceInstance,
  type Scope,
  type ScopeKind,
  type Symbol,
  type SymbolKind,
} from "./model.js"
export { defineSymbol, dialectOf, isLibrarySymbol, lookupLocal } from "./scope.js"
export { memoByProject } from "./cache.js"
export { gvlName, type SymbolTableInput } from "./binder.js"

// navigation
export {
  childScopesByName,
  enclosingPou,
  externalGlobal,
  findChildScope,
  findScopeByName,
  gvlBlockOf,
  hasUnresolvedBase,
  lookup,
  lookupUnit,
  lookupGlobal,
  lookupMember,
  bareEnumMember,
  resolveBareEnumMember,
  resolveGvlMember,
  resolveQualifiedConst,
  rootOf,
  scopeForUnit,
  symbolDefinedAt,
  visibleNames,
  type BareEnumMember,
  type LookupResult,
} from "./scope-nav.js"
export { ancestry, baseOf, basesOf, extendsChain, extendsCycle } from "./extends.js"
export { libraryRank, pickForAsker, scopeUri } from "./precedence.js"
export { manifestsByTitle } from "./library-namespaces.js"

// the names a conditional pragma asks
export { bodyConditionWorld, conditionWorld } from "./condition-world.js"

// the bodies analysed, each in its scope
export { bodies, bodiesAt, bodiesThroughErrors, forEachDecl, forEachExpr, sourceBodies, type UnitBody } from "./scoped-bodies.js"

/**
 * BUILDING THE TABLE — a whole project from its files (`buildSymbolTable`); the incremental unit of work the live
 * server uses (`bindFile`, `unbindFile`, then `relink`: canonical order and EXTENDS linking, never apart); and a scope a
 * consumer builds for its own lookups without the project seeing it (`localScope`).
 */
export const build = { buildSymbolTable, bindFile, unbindFile, relink, localScope } as const
