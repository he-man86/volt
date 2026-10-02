/**
 * THE PROJECT TABLE, BUILT AND KEPT CURRENT — a whole table from a set of files (`buildSymbolTable`), and the
 * incremental unit of work the live server uses: bind one file, unbind one file, `relink`.
 *
 * `relink` is canonical order and EXTENDS linking, never apart (see `canonicalize`): every path that changes which
 * files are bound re-runs it.
 */
import type { CompileEnvironment, Dialect } from "../syntax/index.js"
import type { LibraryManifest } from "../library/index.js"
import type { Scope } from "./model.js"
import { createProjectScope } from "./scope.js"
import { invalidate } from "./cache.js"
import { ingestTopLevel, type SymbolTableInput } from "./binder.js"
import { linkExtends } from "./extends.js"
import { bindLibraryNamespaces } from "./library-namespaces.js"

/** Build one project scope from a set of parsed files, then link EXTENDS bases across all of them.
 *  `manifests` are the referenced libraries' `.library` files (`parseLibraryManifest`), each binding its own
 *  units under the NAMESPACE the source qualifies them with. `environment` is what the CALLER measured of the device and
 *  the project's compile settings (`Scope.environment`); the LSP passes none. */
export function buildSymbolTable(
  files: readonly SymbolTableInput[],
  manifests: readonly LibraryManifest[] = [],
  dialect: Dialect = "codesys",
  environment?: CompileEnvironment,
): Scope {
  const project = createProjectScope(dialect, environment)
  for (const file of files) bindFile(project, file)
  relink(project, manifests)
  bindLibraryNamespaces(project, manifests)
  return project
}

/**
 * Bind ONE file's units into an existing project scope (the incremental-index unit of work). Appends the
 * file's top-level scopes + project symbols; tags each new top-level child with the file URI so
 * `unbindFile` can drop exactly this file's contribution later. Caller re-runs `relink` afterwards.
 */
export function bindFile(project: Scope, { uri, parseResult }: SymbolTableInput): void {
  const start = project.children.length
  // Track the most recent FB/PROGRAM/INTERFACE scope in THIS file so standalone
  // methods/actions/properties that follow it (the workspace one-item-per-file layout:
  // a POU, then its members as top-level siblings) parent to it — else member-var
  // references in those bodies resolve nowhere.
  let currentMemberHost: Scope | undefined
  for (const unit of parseResult.units) {
    const newScope = ingestTopLevel(project, unit, uri, currentMemberHost)
    if (unit.kind === "function_block" || unit.kind === "program" || unit.kind === "interface") {
      currentMemberHost = newScope
    }
    if (unit.kind === "function") currentMemberHost = undefined
  }
  // Only makeScope(project, …) appends to project.children, so the new top-level scopes are exactly this
  // slice — tag them with the file URI. Nested member scopes (children of these) need no tag: dropping the
  // top-level scope drops its whole subtree.
  for (let i = start; i < project.children.length; i++) project.children[i]!.defUri = uri
  invalidate(project) // children changed: every lazy index and every project-wide memo
}

/**
 * Remove one file's contribution from a project scope: its top-level scopes (by `defUri` tag, subtrees
 * included) and its project-level symbols (by `Symbol.uri`). Inverse of `bindFile`. Caller re-runs
 * `relink` so any base pointer into a removed scope is dropped.
 */
export function unbindFile(project: Scope, uri: string): void {
  project.children = project.children.filter((c) => c.defUri !== uri)
  for (const [key, arr] of project.symbols) {
    const kept = arr.filter((s) => s.uri !== uri)
    if (kept.length === 0) project.symbols.delete(key)
    else if (kept.length !== arr.length) project.symbols.set(key, kept)
  }
  invalidate(project)
}

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
function canonicalize(project: Scope): void {
  const at = (u: string | undefined): string => u ?? ""
  project.children.sort(
    (a, b) =>
      (at(a.defUri) < at(b.defUri) ? -1 : at(a.defUri) > at(b.defUri) ? 1 : 0) ||
      (a.span?.start ?? 0) - (b.span?.start ?? 0),
  )
  for (const syms of project.symbols.values())
    syms.sort(
      (a, b) =>
        (at(a.uri) < at(b.uri) ? -1 : at(a.uri) > at(b.uri) ? 1 : 0) ||
        (a.span?.start ?? 0) - (b.span?.start ?? 0),
    )
  // The lazy indices are built off these orders, so they cannot survive a reorder.
  invalidate(project)
}
