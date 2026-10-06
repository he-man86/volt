/**
 * ambiguous-global (D · names/) — C0136. A bare reference to a global that is declared in more than one GVL is
 * ambiguous: the compiler can't tell which one is meant. A qualified `GVL.name` is fine (it's not a bare ident,
 * so never visited here).
 *
 * Conservative (zero-FP): the "ambiguous" set is names declared bare (not `qualified_only`) in 2+ distinct
 * PROJECT GVLs — library GVLs are excluded because their signatures flatten into project scope and would
 * manufacture false duplicates (ERR_OK, NULL, … live in many library GVLs). A reference locally shadowed by a
 * var/param is skipped.
 *
 * And a bare ENUM MEMBER two of the project's enums declare (rule EN3, `types/names` `resolveBareName` answers it
 * "ambiguous", `said`): the same words on both vendors, in every context it is written in (`fixtures/names/enums.ts`
 * `enum_same_member_*`, 2026-10-02). Two of a referenced LIBRARY's enums are only "Identifier not defined".
 * The candidate names are those two of the project's enums share (`sharedMembers`), so the search order is asked only
 * for them.
 */
import { forEachExpr, isLibrarySymbol, lookup, memoByProject, type Scope } from "../../../frontend/symbols/index.js"
import { resolveBareName } from "../../../frontend/types/index.js"
import type { CheckContext } from "../../pipeline/context.js"
import { SOURCE, type DiagnosticItem } from "../../shared/diagnostic-item.js"

/** The ambiguous-global set is a PROJECT-WIDE invariant (names in 2+ bare project GVLs) — it does NOT vary per
 *  file, so compute it once per project and reuse; without this a 10k-symbol project rescans per file. Memoized per
 *  project GENERATION (`memoByProject`), because an incremental re-index rebinds into the same Scope — keyed on the
 *  Scope alone, a GVL an edit added was never counted. */
const ambiguousGlobals = memoByProject((project: Scope): ReadonlySet<string> => {
  const s = new Set<string>()
  for (const [key, syms] of project.symbols) {
    const uris = new Set<string>()
    for (const sym of syms) if (sym.kind === "gvl_var" && sym.qualifiedOnly !== true && !isLibrarySymbol(sym)) uris.add(sym.uri)
    if (uris.size >= 2) s.add(key)
  }
  return s
})

/** The member names two of the project's open enums both declare — a superset of the ambiguous ones (a library's enum is
 *  no candidate for the application, a local shadows); `resolveBareName` decides each use. */
const sharedMembers = memoByProject((project: Scope): ReadonlySet<string> => {
  const seen = new Set<string>()
  const shared = new Set<string>()
  for (const child of project.children) {
    if (child.kind !== "enum" || child.qualifiedOnly === true) continue
    for (const key of child.symbols.keys()) (seen.has(key) ? shared : seen).add(key)
  }
  return shared
})

export function checkAmbiguousGlobal(ctx: CheckContext, out: DiagnosticItem[]): void {
  const ambiguous = ambiguousGlobals(ctx.project)
  const members = sharedMembers(ctx.project)
  if (ambiguous.size === 0 && members.size === 0) return
  // `a.b` visits `b` as a standalone ident too, but a QUALIFIED member is never ambiguous — collect the
  // member-position nodes (pre-order: the member expr is seen before its `.member` child) and skip them.
  const qualified = new WeakSet<object>()
  forEachExpr(ctx.parseResult, ctx.project, (e, scope) => {
    if (e.kind === "member") {
      qualified.add(e.member)
      return
    }
    // a named argument's parameter is the callee's, not a bare reference
    if (e.kind === "call") for (const a of e.args) if (a.param !== undefined) qualified.add(a.param)
    if (e.kind !== "ident_expr" || qualified.has(e)) return
    const key = e.name.toLowerCase()
    if (ambiguous.has(key)) {
      const sym = lookup(scope, e.name)?.symbol
      if (sym !== undefined && sym.kind !== "gvl_var") return // a local var/param shadows → unambiguous
    } else {
      if (!members.has(key)) return
      const named = resolveBareName(scope, e.name)
      if (named.kind !== "ambiguous" || !named.said) return
    }
    out.push({
      severity: "error",
      span: e.span,
      source: SOURCE,
      code: "ambiguous-global",
      message: ctx.messages.ambiguousGlobalName(e.name),
    })
  })
}
