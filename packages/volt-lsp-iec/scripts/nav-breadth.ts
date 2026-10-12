/**
 * NAVIGATION BREADTH over the six corpora — what workspace symbols, call hierarchy and rename answer on real projects, and
 * what they miss (openspec `lsp-quick-fixes` 0.1; re-run after 2.4 to show a closed gap moved).
 *
 *   bun scripts/nav-breadth.ts
 *
 * Each project is read into the store the server builds (`scanWorkspace` → `WorkspaceStore`), then:
 *   WORKSPACE SYMBOLS  every symbol declared in PROJECT source (not a library), by kind, against what `workspaceSymbols`
 *                      returns for the empty query; plus how many library symbols that answer carries.
 *   CALL HIERARCHY     every call in a project ST body, by what its callee resolves to; per callable target, the calls
 *                      `callIncoming` reports against the calls counted here; per body, `prepareCallHierarchy` on its own
 *                      name and `callOutgoing` against the calls counted here.
 *   RENAME             every method/property of a project FB that has a same-named member in a base or an implemented
 *                      interface (an override chain): whether the base is a library's (a rename the project cannot make
 *                      whole) or the project's, and for the project's whether `renameAnywhere` on the base edits the
 *                      override too.
 */
import type { Range } from "vscode-languageserver-protocol"
import { resolveConfig } from "../src/analysis/index.js"
import { walkAllExprs } from "../src/frontend/syntax/index.js"
import { ancestry, childScopesByName, findScopeByName, isLibrarySymbol, type Scope, sourceBodies, type Symbol } from "../src/frontend/symbols/index.js"
import { resolveMemberChain } from "../src/frontend/types/index.js"
import { callIncoming, callOutgoing, prepareCallHierarchy, rangeFromSpan, renameAnywhere, workspaceSymbols, type Document } from "../src/services/index.js"
import { NETWORK_TEXT_ENABLED } from "../src/server/config.js"
import { isLibraryUri } from "../src/frontend/library/index.js"
import { WorkspaceStore } from "../src/workspace/workspace-store.js"
import { scanWorkspace } from "../src/workspace/workspace-refs.js"
import { failLoud } from "../test/support/fail-loud.js"
import { corpusProjects } from "../test/frontend/sources.js"

const key = (uri: string, r: Range) => `${uri}#${r.start.line}:${r.start.character}`
const bump = (m: Map<string, number>, k: string, n = 1) => m.set(k, (m.get(k) ?? 0) + n)
const show = (m: Map<string, number>) => [...m].sort((a, b) => b[1] - a[1]).map(([k, n]) => `${k} ${n}`).join(", ")

function allSymbols(scope: Scope, out: Symbol[] = []): Symbol[] {
  for (const syms of scope.symbols.values()) out.push(...syms)
  for (const c of scope.children) allSymbols(c, out)
  return out
}

function workspaceSymbolBreadth(project: Scope): void {
  const answered = new Set(workspaceSymbols(project, "").map((s) => key(s.location.uri, s.location.range)))
  const declared = new Map<string, number>()
  const hit = new Map<string, number>()
  let library = 0
  for (const s of new Set(allSymbols(project))) {
    const k = key(s.uri, rangeFromSpan(s.declarationSpan))
    if (isLibrarySymbol(s)) {
      if (answered.has(k)) library++
      continue
    }
    bump(declared, s.kind)
    if (answered.has(k)) bump(hit, s.kind)
  }
  const rows = [...declared].sort((a, b) => b[1] - a[1]).map(([k, n]) => `${k} ${hit.get(k) ?? 0}/${n}`)
  console.log(`  workspace symbols (answered/declared, project source): ${rows.join(", ")}; library symbols in the answer: ${library}`)
}

function callBreadth(project: Scope, docs: readonly Document[]): void {
  const byKind = new Map<string, number>()
  const sites = new Map<Symbol, number>()
  let prepared = 0
  let unprepared = 0
  const unpreparedKinds = new Map<string, number>()
  let outgoingCounted = 0
  let outgoingAnswered = 0
  for (const doc of docs) {
    if (isLibraryUri(doc.uri)) continue
    for (const { unit, scope, statements } of sourceBodies(doc.parseResult.units, project)) {
      let own = 0
      walkAllExprs(statements, (e) => {
        if (e.kind !== "call") return
        const callee = resolveMemberChain(e.callee, scope, project)
        bump(byKind, callee === undefined ? "(unresolved)" : `${callee.kind}${isLibrarySymbol(callee) ? " (library)" : ""}`)
        if (callee !== undefined && ["function_block", "function", "method", "action"].includes(callee.kind)) {
          sites.set(callee, (sites.get(callee) ?? 0) + 1)
          own++
        }
      })
      if (!("name" in unit)) continue
      const prep = prepareCallHierarchy(doc, project, unit.name.span.start)
      if (prep === undefined) {
        unprepared++
        bump(unpreparedKinds, unit.kind)
        continue
      }
      prepared++
      outgoingCounted += own
      outgoingAnswered += callOutgoing(doc, project, prep.sym).reduce((n, c) => n + c.ranges.length, 0)
    }
  }
  console.log(`  call sites by callee: ${show(byKind)}`)
  console.log(`  bodies whose own name prepares a call hierarchy: ${prepared}; not: ${unprepared} (${show(unpreparedKinds)})`)
  console.log(`  outgoing: ${outgoingAnswered} calls answered of ${outgoingCounted} counted in the prepared bodies`)
  // incoming: the 25 most-called targets (callIncoming walks the whole project per target)
  const top = [...sites].sort((a, b) => b[1] - a[1]).slice(0, 25)
  let counted = 0
  let answered = 0
  const short: string[] = []
  for (const [sym, n] of top) {
    const got = callIncoming(docs, project, sym).reduce((k, c) => k + c.ranges.length, 0)
    counted += n
    answered += got
    if (got < n) short.push(`${sym.name} (${sym.kind}) ${got}/${n}`)
  }
  console.log(`  incoming, top ${top.length} targets: ${answered} answered of ${counted} counted${short.length ? `; short: ${short.slice(0, 6).join(", ")}` : ""}`)
}

const MEMBER = new Set(["method", "property", "interface_method", "interface_property"])

/** The interface names an FB scope's own declaration IMPLEMENTS — read from its symbol (a `Scope` does not carry it). */
function implementsOf(scope: Scope): string[] {
  const sym = scope.parent?.symbols.get(scope.name.toLowerCase())?.find((s) => s.kind === "function_block" && s.declarationSpan === scope.span)
  // an FB's ancestry is FBs; a scope whose symbol is not found would silently drop its IMPLEMENTS — refuse instead
  if (sym === undefined) throw new Error(`no function_block symbol for scope '${scope.name}' (${scope.kind})`)
  return ((sym?.ast as { implements?: readonly { text: string }[] } | undefined)?.implements ?? []).map((i) => i.text)
}

function renameBreadth(project: Scope, store: WorkspaceStore, docs: readonly Document[]): void {
  let libraryBase = 0
  let projectBase = 0
  let followed = 0
  let tried = 0
  for (const fb of new Set(allSymbols(project))) {
    if (fb.kind !== "function_block" || isLibrarySymbol(fb)) continue
    const scope = childScopesByName(fb.owner, fb.name).find((c) => c.span === fb.declarationSpan)
    if (scope === undefined) continue
    // Everything a member of this FB overrides or implements: its EXTENDS ancestry, and the interfaces (with THEIR
    // ancestry) that the FB OR ANY BASE FB implements — an interface a base implements is implemented by the derived FB
    // too (review 2026-10-12: only the FB's own IMPLEMENTS list was read, which undercounted both chain kinds).
    const fbs = ancestry(scope)
    const above = [
      ...fbs.slice(1),
      ...fbs.flatMap((s) =>
        implementsOf(s).flatMap((i) => {
          const found = findScopeByName(project, i, fb.uri)
          return found === undefined ? [] : ancestry(found)
        }),
      ),
    ]
    for (const syms of scope.symbols.values())
      for (const m of syms) {
        if (!MEMBER.has(m.kind)) continue
        const bases = [...new Set(above.flatMap((s) => s.symbols.get(m.name.toLowerCase()) ?? []).filter((b) => MEMBER.has(b.kind)))]
        if (bases.length === 0) continue
        // A chain that reaches a library member ANYWHERE is a library chain (B6 refuses its rename), whatever project
        // member it also overrides — `.find()` took the first base found and filed such a member as project-only.
        if (bases.some(isLibrarySymbol)) {
          libraryBase++
          continue
        }
        const base = bases[0]!
        projectBase++
        const doc = store.doc(base.uri)
        if (doc === undefined || tried >= 40) continue
        tried++
        const edit = renameAnywhere(docs, project, doc, base.span.start, `${base.name}Renamed`)
        const edits = new Set(Object.entries(edit?.changes ?? {}).flatMap(([uri, es]) => es.map((e) => key(uri, e.range))))
        if (edits.has(key(m.uri, rangeFromSpan(m.span)))) followed++
      }
  }
  console.log(`  override chains: ${libraryBase} members override/implement a LIBRARY member, ${projectBase} a PROJECT member`)
  console.log(`  rename of the project base edits the override too: ${followed} of ${tried} tried`)
}

for (const p of corpusProjects()) {
  const scan = scanWorkspace(p.dir)
  const store = new WorkspaceStore(resolveConfig({ vendor: p.vendor, diagnostics: scan.projectDiagnostics }), { networkText: NETWORK_TEXT_ENABLED }, failLoud)
  store.setRefs(scan.refs, scan.taskRoots)
  store.seedDisk(scan.sources.map((s) => ({ uri: s.path, source: s.source })))
  const project = store.project()
  const docs = store.workspace()
  console.log(`\n## ${p.name} (${p.vendor}, ${docs.length} documents, ${docs.filter((d) => isLibraryUri(d.uri)).length} library)`)
  workspaceSymbolBreadth(project)
  callBreadth(project, docs)
  renameBreadth(project, store, docs)
}
