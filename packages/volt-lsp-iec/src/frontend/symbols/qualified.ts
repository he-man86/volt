/**
 * THE QUALIFIED QUERIES — a GVL member through its list (`GVL.x`), a bare enum member, a qualified constant. Split
 * from `scope-nav.ts` (openspec lsp-same-standard design.md §2.2).
 */
import type { Expr } from "../syntax/index.js"
import type { Scope, Symbol } from "./model.js"
import { scopeUri, libraryRank } from "./precedence.js"
import { lookup, findChildScope, lookupGlobal, rootOf, lookupMember } from "./scope-nav.js"
import { isLibrarySymbol, lookupLocal } from "./scope.js"

/** `GVL.field` → the flat project-level `gvl_var` sharing the block's uri, or undefined. Type inference and constant
 *  folding both qualify through it (it lived privately in the old `infer` module). `.GVL.field` names the list in the global
 *  namespace only (rule E33): `ARRAY [1...L_MC1P_Constants.gc_Rec_Max]` in a lenze library, `1..` then `.L_MC1P_…`. */
export function resolveGvlMember(expr: { base: Expr; member: { name: string } }, scope: Scope, project: Scope): Symbol | undefined {
  const block = gvlBlockOf(expr.base, scope, project)
  if (block === undefined) return undefined
  return lookupLocal(project, expr.member.name).find((sym) => sym.kind === "gvl_var" && sym.uri === block.uri)
}

/**
 * The global variable list a qualifier names — `GVL` in `GVL.v`, `.GVL` in the global namespace, or `Ns.GVL` inside a
 * library's namespace (`Stu.GVL_UTF8.HALFSHIFT` builds, `sym_library_gvl_qualified_fully`) — or undefined.
 */
export function gvlBlockOf(base: Expr, scope: Scope, project: Scope): Symbol | undefined {
  if (base.kind === "member") {
    const ns = base.base.kind === "ident_expr" ? lookup(scope, base.base.name)?.symbol : undefined
    if (ns?.kind !== "namespace") return undefined
    const nsScope = findChildScope(project, ns.name, scope.defUri)
    return nsScope === undefined ? undefined : lookupLocal(nsScope, base.member.name).find((s) => s.kind === "gvl_block")
  }
  if (base.kind !== "ident_expr" && base.kind !== "global_expr") return undefined
  const block = base.kind === "global_expr" ? lookupGlobal(project, base.name.name) : lookup(scope, base.name)?.symbol
  return block?.kind === "gvl_block" ? block : undefined
}

/**
 * What a bare name names among the enum members: the one member, or the several that leave it naming nothing. `said`: an
 * ambiguity among the asker's OWN enums is "Ambiguous use of name" on both vendors; one among a referenced library's is
 * only "Identifier not defined" (`enum_library_same_member_one_library`, `_two_libraries`, CODESYS 2026-10-02).
 */
export type BareEnumMember = { kind: "member"; symbol: Symbol } | { kind: "ambiguous"; candidates: readonly Symbol[]; said: boolean }

/**
 * A bare enum member (`StateAutomatic`), as the name written in `asker` reaches it — structural, no type inference, hence
 * layer B. Measured (`fixtures/names/enums.ts`, frontend-conformance 3.3, CODESYS and TwinCAT 2026-10-02):
 *   - a `{attribute 'qualified_only'}` enum's member is no candidate: only `Enum.Member` reaches it (EN1);
 *   - a member TWO of the asker's own enums declare is "Ambiguous use of name" and "Identifier not defined", in every
 *     context — a store to one of the two enums, to an INT, a comparison, a CASE label (EN3): no expected-type pick;
 *   - the asker's own enums first (`precedence` rank 0: the application's for project source): a project enum's member
 *     beside a referenced library's of its name is the project's (`enum_library_member_vs_project_enum`, EN6);
 *   - else a referenced library's member resolves bare when ONE enum declares it (Util's `SAWTOOTH_RISE`,
 *     `enum_library_bare`), and is only "Identifier not defined" when several do, of one library or of two.
 * Which libraries are referenced DIRECTLY (a transitive one's enum is "Unknown type" bare) is LB2's question — a bridge fact the
 * manifest does not carry (3.4.2, `lib_ns_transitive_bare`), so every referenced library's enums are candidates.
 */
export function resolveBareEnumMember(asker: Scope, name: string): BareEnumMember | undefined {
  const project = rootOf(asker)
  const askerUri = scopeUri(asker)
  const target = name.toLowerCase()
  let best: Symbol[] = []
  let bestRank = Number.POSITIVE_INFINITY
  for (const child of project.children) {
    if (child.kind !== "enum" || child.qualifiedOnly === true) continue
    const sym = child.symbols.get(target)?.[0]
    if (sym === undefined) continue
    const rank = libraryRank(project, child.defUri, askerUri)
    if (rank < bestRank) [best, bestRank] = [[sym], rank]
    else if (rank === bestRank) best.push(sym)
  }
  if (best.length === 0) return undefined
  return best.length === 1 ? { kind: "member", symbol: best[0]! } : { kind: "ambiguous", candidates: best, said: bestRank === 0 }
}

/** The enum member a bare name written in `asker` names — undefined where no enum's member reaches it, or several do. */
export function bareEnumMember(asker: Scope, name: string): Symbol | undefined {
  const member = resolveBareEnumMember(asker, name)
  return member?.kind === "member" ? member.symbol : undefined
}

/**
 * `List.Const` / `Program.Const` — the variable a qualified name reaches through its global variable list or its
 * PROGRAM, or undefined. A library's are not reached: its declarations may be partial (the constant folder reads its
 * value, `const/fold`).
 */
export function resolveQualifiedConst(expr: Extract<Expr, { kind: "member" }>, scope: Scope): Symbol | undefined {
  const named = expr.base
  if (named.kind !== "ident_expr" && named.kind !== "global_expr") return undefined
  const project = rootOf(scope)
  // `.List.Const` names the list in the global namespace only (rule E33)
  const base = named.kind === "global_expr" ? lookupGlobal(project, named.name.name) : lookup(scope, named.name)?.symbol
  if (base === undefined || isLibrarySymbol(base)) return undefined
  const programScope = base.kind === "program" ? findChildScope(project, base.name) : undefined
  const target =
    base.kind === "gvl_block" ? resolveGvlMember(expr, scope, project) : programScope && lookupMember(programScope, expr.member.name)
  return target === undefined || isLibrarySymbol(target) ? undefined : target
}
