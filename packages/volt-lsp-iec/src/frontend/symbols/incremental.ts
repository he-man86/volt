/**
 * THE PROJECT TABLE, BUILT AND KEPT CURRENT — a whole table from a set of files (`buildSymbolTable`), and the
 * incremental unit of work the live server uses: bind one file, unbind one file, `relink`.
 *
 * `relink` is canonical order and EXTENDS linking, never apart (see `canonicalize`): every path that changes which
 * files are bound re-runs it.
 */
import type { CompileEnvironment, Dialect } from "../syntax/index.js"
import type { LibraryManifest } from "../library/index.js"
import type { DeviceInstance, Scope } from "./model.js"
import { createProjectScope, takeProjectKeys, takeUnsortedKeys } from "./scope.js"
import { invalidate, left, placedTopLevel, takeAppended } from "./cache.js"
import { ingestDevices, ingestUnits, type SymbolTableInput } from "./binder.js"
import { linkExtends, noteTopLevel } from "./extends.js"
import { bindLibraryNamespaces } from "./library-namespaces.js"

/** Build one project scope from a set of parsed files, then link EXTENDS bases across all of them.
 *  `manifests` are the referenced libraries' `.library` files (`parseLibraryManifest`), each binding its own
 *  units under the NAMESPACE the source qualifies them with. `environment` is what the CALLER measured of the device and
 *  the project's compile settings (`Scope.environment`); the LSP passes none. `devices` are the project's device-tree
 *  instances, from its `.device` descriptors (`ingestDevices`, rule Y24). */
export function buildSymbolTable(
  files: readonly SymbolTableInput[],
  manifests: readonly LibraryManifest[] = [],
  dialect: Dialect = "codesys",
  environment?: CompileEnvironment,
  devices: readonly DeviceInstance[] = [],
): Scope {
  const project = createProjectScope(dialect, environment)
  for (const file of files) bindFile(project, file)
  ingestDevices(project, devices)
  invalidate(project)
  relink(project, manifests)
  bindLibraryNamespaces(project, manifests)
  // ...and into canonical order once more: the namespace scopes are appended, and every later relink (the live server's
  // first keystroke) moved them to the front — so a built project and the same project one edit later disagreed on the
  // order every first-match lookup reads, and that first edit paid for re-answering every name a namespace holds
  // (~30 ms on pro2193, 2026-10-02). Nothing to re-link: a namespace scope is no base.
  relink(project, manifests)
  return project
}

/**
 * Bind ONE file's units into an existing project scope (the incremental-index unit of work). Appends the
 * file's top-level scopes + project symbols; tags each new top-level child with the file URI so
 * `unbindFile` can drop exactly this file's contribution later. Caller re-runs `relink` afterwards.
 */
export function bindFile(project: Scope, { uri, parseResult }: SymbolTableInput): void {
  const start = project.children.length
  // standalone methods/actions/properties parent to the POU written before them (`ingestUnits`)
  ingestUnits(project, parseResult.units, uri)
  // Only makeScope(project, …) appends to project.children, so the new top-level scopes are exactly this
  // slice — tag them with the file URI. Nested member scopes (children of these) need no tag: dropping the
  // top-level scope drops its whole subtree.
  const tops = project.children.slice(start)
  for (const top of tops) top.defUri = uri
  let files = topsByFile.get(project)
  if (files === undefined) topsByFile.set(project, (files = new Map()))
  files.set(uri, [...(files.get(uri) ?? []), ...tops])
  noteTopLevel(project, tops, true)
  invalidate(project) // children changed: every lazy index and every project-wide memo
}

/**
 * Remove one file's contribution from a project scope: its top-level scopes (by `defUri` tag, subtrees
 * included) and its project-level symbols (by `Symbol.uri`). Inverse of `bindFile`. Caller re-runs
 * `relink` so any base pointer into a removed scope is dropped.
 */
export function unbindFile(project: Scope, uri: string): void {
  const files = topsByFile.get(project)
  const removed = files?.get(uri) ?? []
  files?.delete(uri)
  for (const top of removed) {
    const at = project.children.lastIndexOf(top)
    if (at < 0) throw new Error(`${uri}: a top-level scope it bound is no longer among the project's children`)
    project.children.splice(at, 1)
    left(project, top)
  }
  noteTopLevel(project, removed, false)
  for (const key of takeProjectKeys(project, uri)) {
    const arr = project.symbols.get(key)
    if (arr === undefined) continue
    const kept = arr.filter((s) => s.uri !== uri)
    if (kept.length === 0) project.symbols.delete(key)
    else if (kept.length !== arr.length) project.symbols.set(key, kept)
  }
  invalidate(project)
}

/** Each project's top-level scopes by the file that bound them — what `unbindFile` takes out, without a pass over every
 *  child of the project. */
const topsByFile = new WeakMap<Scope, Map<string, Scope[]>>()

/** Canonical order, then EXTENDS linking — the one re-link after files were bound or unbound. */
export function relink(project: Scope, manifests: readonly LibraryManifest[] = []): void {
  canonicalize(project)
  linkExtends(project, manifests)
}

/**
 * Put the project scope into a CANONICAL order: by defining URI, then by position within that file.
 *
 * <b>Why this is not cosmetic.</b> `project.children` and each `project.symbols` array are in BIND order,
 * which is the order files were handed to the binder — `readdirSync` order in a batch build, and open/edit
 * order in the live server. Every lookup that takes the first match therefore inherits it, and a real project
 * has duplicates for them to disagree about: 343 top-level names in the six corpus projects have more than
 * one candidate, because two referenced libraries may legitimately export the same bare name.
 *
 * Measured: lowering the corpus with the files reversed produced a different set of routines — 588 against
 * 558 — with no other change. Names resolved to a different library, so a hover, a go-to-definition and the
 * transpiler's output all depended on the shape of the disk.
 *
 * <b>Canonical is not the same as CORRECT</b>, and the difference is worth stating. Sorting makes the answer
 * the same everywhere; it does not make it the right one when two libraries really do export different types
 * under one name. That question needs to know WHO is asking, and `linkExtends` below answers it properly for
 * `EXTENDS` using the manifests' own `DEPENDENCIES`. Lookups that have no asker in hand get determinism here
 * and nothing more — which is strictly better than what they had, and honest about what is still open.
 *
 * It runs in `relink`, with `linkExtends`, because every path that mutates the table re-runs that — `buildSymbolTable`
 * once at the end, `workspace-store` after each `bindFile`/`unbindFile`. Apart, they would be a second thing to
 * remember, and the first caller to forget it would reintroduce exactly this bug.
 */
//
// <b>It costs the change, not the project</b> (a rebind re-sorted every array: ~5 ms of each keystroke on pro2193,
// 2026-10-02), and the order it leaves is exactly the stable sort's. Children: an unbind takes scopes out (order kept) and
// a bind appends, so the array is a sorted prefix and the suffix appended since the last call (`takeAppended`); each of
// those is inserted after every scope that sorts equal to it, in the order appended — which is where a stable sort puts
// it. A long suffix (a whole build) is sorted. Symbols: only the keys that gained a symbol since the last sort can be out
// of order (`takeUnsortedKeys`).
function canonicalize(project: Scope): void {
  const at = (u: string | undefined): string => u ?? ""
  const byPlace = (a: Scope, b: Scope): number =>
    (at(a.defUri) < at(b.defUri) ? -1 : at(a.defUri) > at(b.defUri) ? 1 : 0) || (a.span?.start ?? 0) - (b.span?.start ?? 0)
  const children = project.children
  const tail = takeAppended(project)
  const sorted = children.length - tail.length
  if (tail.some((scope, i) => children[sorted + i] !== scope))
    throw new Error("the scopes appended to the project since its last canonical order are not the end of its children")
  if (tail.length > SORT_TAIL) {
    children.sort(byPlace)
    placedTopLevel(project, "all", byPlace)
  } else if (tail.length > 0) {
    children.length = sorted
    for (const scope of tail) {
      let lo = 0
      let hi = children.length
      while (lo < hi) {
        const mid = (lo + hi) >> 1
        if (byPlace(children[mid], scope) <= 0) lo = mid + 1
        else hi = mid
      }
      children.splice(lo, 0, scope)
    }
    placedTopLevel(project, tail, byPlace)
  }
  for (const key of takeUnsortedKeys(project))
    project.symbols
      .get(key)
      ?.sort(
        (a, b) =>
          (at(a.uri) < at(b.uri) ? -1 : at(a.uri) > at(b.uri) ? 1 : 0) || (a.span?.start ?? 0) - (b.span?.start ?? 0),
      )
  // The lazy indices are built off these orders, so they cannot survive a reorder.
  invalidate(project)
}

/** A suffix longer than this is sorted with the rest rather than inserted scope by scope (the same order either way). */
const SORT_TAIL = 64
