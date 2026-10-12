/**
 * WorkspaceStore — the live server's document + project state (the workspace layer; extracted from `server.ts`).
 *
 * Two source layers feed one project symbol table:
 *   - `open`  — `TextDocument`s the client has opened (an unsaved edit still drives analysis).
 *   - `disk`  — parsed source files crawled from the workspace root / delivered by watched-file events.
 * For any file present in both, the open buffer wins (`docs()` merge). Everything is keyed by a
 * normalized URI so an open buffer and its on-disk file collapse to one entry. An open document is parsed once per
 * version (a `(uri, version)` cache shared by every query).
 *
 * `generation` counts the mutations that change what analysis sees (merged sources, references, task roots, config);
 * one that leaves the merged text as it was (a buffer opened equal to its disk copy, an unedited buffer closed, equal
 * bytes rewritten) does not — the diagnostics publisher's cache key (lsp-server-scheduling). The disk layer changes per
 * FILE (`upsertDisk` / `deleteDisk`), a watched batch's files rebound together (`diskBatch`). A document whose parse or
 * bind THROWS is quarantined: reported by name (`FailureReport`), left out of the merged set until its content
 * changes, the project rebuilt without it.
 */
import { TextDocument } from "vscode-languageserver-textdocument"
import { folderKey, normalizeKey } from "./document-key.js"
import { parseDocument, type ParseOptions, type Span } from "../frontend/syntax/index.js"
import { build, type Scope } from "../frontend/symbols/index.js"
import type { ResolvedConfig } from "../analysis/index.js"
import { DeadCodeCache } from "./dead-code-cache.js"
import { EMPTY_WORKSPACE_REFS, type WorkspaceRefs } from "./workspace-refs.js"
import { bindFailures, buildProject } from "./project-build.js"
import { Quarantine, type Layer } from "./quarantine.js"
import type { Document } from "../services/index.js"

/** Where a document that could not be analysed is told — the server logs it to the client. REQUIRED, never
 *  defaulted: a test passes one that rethrows. */
export type FailureReport = (uri: string, error: unknown) => void

export class WorkspaceStore {
  private open = new Map<string, TextDocument>()
  private disk = new Map<string, Document>()
  private cache = new Map<string, { version: number; doc: Document }>() // key → last parsed open version; survives invalidate()
  private readonly failed = new Quarantine() // per layer: a buffer's quarantine is never its disk copy's
  private gen = 0
  /** The disk keys an open `diskBatch` changed, rebound when it closes. */
  private pending: Set<string> | undefined

  // Reference-file catalogs + reachability seeds, refreshed on init and on watched-file events (`setRefs`).
  private refs: WorkspaceRefs = EMPTY_WORKSPACE_REFS
  private roots: ReadonlySet<string> | undefined

  private cachedDocs: Document[] | undefined
  // The project symbol table, maintained INCREMENTALLY: built once (lazily), then a single-file edit
  // re-indexes only that file (`rebindKeys`) instead of rebuilding the whole table per keystroke. Undefined
  // until first built or after a full disk reseed. `boundDocs` mirrors what is currently bound, keyed like
  // `docs()` (normalized key → the exact Document object bound), so an edit can unbind the old + bind the new.
  private projectScope: Scope | undefined
  private boundDocs = new Map<string, Document>()
  private readonly dead = new DeadCodeCache({
    docs: () => this.docs(),
    roots: () => this.roots,
    diagnoseDeadCode: () => this.cfg.diagnoseDeadCode,
    keyOf: normalizeKey,
  })

  constructor(
    private cfg: ResolvedConfig,
    /** How every parse of this store reads its sources — network text on or off. REQUIRED, never defaulted: the server
     *  passes what its environment says (`server/config.ts`), and a test states its own. */
    private readonly parse: ParseOptions,
    private readonly onFailure: FailureReport,
  ) {}

  /** Bumped by every mutation that changes what analysis sees (the file header says which do not). */
  get generation(): number {
    return this.gen
  }
  get workspaceRefs(): WorkspaceRefs {
    return this.refs
  }
  get taskRoots(): ReadonlySet<string> | undefined {
    return this.roots
  }
  get config(): ResolvedConfig {
    return this.cfg
  }
  set config(config: ResolvedConfig) {
    this.cfg = config
    this.gen++
  }

  /** The references AND the task roots, in one mutation: the project scope and the dead caches are rebuilt from the
   *  cached parses (nothing is re-parsed), the dead set from the NEW roots. */
  setRefs(refs: WorkspaceRefs, taskRoots: ReadonlySet<string> | undefined): void {
    this.refs = refs
    this.roots = taskRoots
    this.dropProject()
  }

  /** Parse an open document once per version; reuse the cached parse for the same (uri, version). Undefined while its
   *  content is quarantined. */
  private openParse(td: TextDocument): Document | undefined {
    const key = normalizeKey(td.uri)
    const source = td.getText()
    if (this.failed.has("open", key, source)) return undefined
    const hit = this.cache.get(key)
    if (hit !== undefined && hit.version === td.version) return hit.doc
    const doc = this.parseOrQuarantine(key, td.uri, source, "open")
    if (doc !== undefined) this.cache.set(key, { version: td.version, doc })
    return doc
  }

  /** The content that threw stays out until it changes; changed content is parsed afresh. Content the OTHER layer
   *  already quarantined is quarantined in this one too, unparsed and not reported again. */
  private parseOrQuarantine(key: string, uri: string, source: string, layer: Layer): Document | undefined {
    if (this.failed.has(layer, key, source)) return undefined
    this.failed.delete(layer, key)
    if (this.failed.has(layer === "open" ? "disk" : "open", key, source)) {
      this.failed.set(layer, key, uri, source)
      this.dropProject()
      return undefined
    }
    try {
      return { uri, source, parseResult: parseDocument(uri, source, this.parse, this.cfg.vendor) }
    } catch (e) {
      this.quarantine(key, uri, source, layer, e)
      return undefined
    }
  }

  /** Leave `source` out of the merged set until it changes, rebuild the project without it, and report it by name. */
  private quarantine(key: string, uri: string, source: string, layer: Layer, error: unknown): void {
    this.failed.set(layer, key, uri, source)
    this.dropProject()
    this.onFailure(uri, error)
  }

  /** A merged document whose BIND threw: quarantined in the layer the client sees it from. */
  private quarantineDoc(doc: Document, error: unknown): void {
    const key = normalizeKey(doc.uri)
    this.quarantine(key, doc.uri, doc.source, this.open.has(key) ? "open" : "disk", error)
  }

  /** Whether the document at `uri` is quarantined: what the client sees of it is the content that threw. */
  quarantined(uri: string): boolean {
    const key = normalizeKey(uri)
    const td = this.open.get(key)
    if (td !== undefined) return this.failed.has("open", key, td.getText())
    const bad = this.failed.source("disk", key)
    return bad !== undefined && (this.disk.get(key)?.source ?? bad) === bad
  }

  /** The URIs of every quarantined document. */
  quarantinedUris(): string[] {
    return this.failed.documents().flatMap(([, uri]) => (this.quarantined(uri) ? [uri] : []))
  }

  /** The merged source set — disk entries overridden by open buffers (open wins). Memoized per edit. */
  private docs(): Document[] {
    if (this.cachedDocs !== undefined) return this.cachedDocs
    const merged = new Map<string, Document>()
    for (const [key, d] of this.disk) if (!this.failed.has("disk", key, d.source)) merged.set(key, d)
    for (const td of this.open.values()) {
      const key = normalizeKey(td.uri)
      const d = this.openParse(td)
      if (d !== undefined) merged.set(key, d)
      else merged.delete(key) // the buffer the user sees is quarantined; its disk copy is not what they see
    }
    return (this.cachedDocs = [...merged.values()])
  }

  /** The project table, built when there is none. A build that throws quarantines every document whose BIND throws
   *  (`bindFailures`) and builds again without them; a throw no one document causes is rethrown. */
  project(): Scope {
    while (this.projectScope === undefined) {
      const docs = this.docs()
      try {
        this.projectScope = buildProject(docs, this.refs, this.cfg.vendor)
      } catch (e) {
        const failed = bindFailures(docs, this.cfg.vendor)
        if (failed.length === 0) throw e
        for (const { doc, error } of failed) this.quarantineDoc(doc, error) // each drops the project: the loop rebuilds
        continue
      }
      this.boundDocs.clear()
      for (const d of docs) this.boundDocs.set(normalizeKey(d.uri), d)
    }
    return this.projectScope
  }

  /** The currently-merged Document for a key (open buffer wins, else disk, else gone) — the bind unit. */
  private mergedDoc(key: string): Document | undefined {
    const td = this.open.get(key)
    if (td !== undefined) return this.openParse(td)
    const d = this.disk.get(key)
    return d !== undefined && !this.failed.has("disk", key, d.source) ? d : undefined
  }

  /** The merged TEXT at a key — what a generation bump compares; undefined when nothing is there. */
  private mergedSource(key: string): string | undefined {
    return this.open.get(key)?.getText() ?? this.disk.get(key)?.source
  }

  /** Incrementally re-index the files at `keys` after an edit or a watched batch: unbind each old contribution, bind
   *  the new, then re-link ONCE. No-op until the project has been built once (a pre-query edit just leaves it unbuilt so
   *  the first `project()` builds fresh). O(changed files) plus one relink, not O(project) — and never a relink per
   *  file: the relink is the dominant cost (~25 ms on pro2193), and a `volt pull` of N files paid it N times. */
  private rebindKeys(keys: readonly string[]): void {
    if (this.projectScope === undefined) return
    // A library file rebinds like any other: `relink` binds the library namespaces afresh when one came or went (rule
    // LB7). This rebuilt the whole table for a file under `Library Manager/` — the namespaces, bound once, would have
    // held what the project no longer had.
    const desired = keys.map((key) => [key, this.mergedDoc(key)] as const) // a parse that throws quarantines (drops the scope)
    const scope = this.projectScope
    if (scope === undefined) return
    for (const [key, doc] of desired) {
      const old = this.boundDocs.get(key)
      if (old !== undefined) build.unbindFile(scope, old.uri)
      if (doc !== undefined) {
        try {
          build.bindFile(scope, { uri: doc.uri, parseResult: doc.parseResult, source: doc.source })
        } catch (e) {
          this.quarantineDoc(doc, e) // drops the half-bound scope
          return
        }
        this.boundDocs.set(key, doc)
      } else {
        this.boundDocs.delete(key)
      }
    }
    // WITH the manifests: `relink` resolves an ambiguous base by the asker's library and its
    // dependencies, and re-linking without them would silently demote every library base to the last rank.
    build.relink(scope, this.refs.libraryManifests)
    for (const [key, doc] of desired) this.dead.afterRebind(key, doc)
  }

  workspace(): Document[] {
    return this.docs()
  }

  /** The client URIs of currently-open documents (for re-publishing diagnostics after a re-index). */
  openUris(): string[] {
    return [...this.open.values()].map((td) => td.uri)
  }

  /** The version of the open buffer at `uri`; undefined when it is not open. */
  openVersion(uri: string): number | undefined {
    return this.open.get(normalizeKey(uri))?.version
  }

  /** The parsed document for a URI — open buffer if opened, else the disk crawl, else undefined (gone or quarantined). */
  doc(uri: string): Document | undefined {
    return this.mergedDoc(normalizeKey(uri))
  }

  /** The POUs nothing reaches, cached across edits (`dead-code-cache.ts`). */
  deadSet(): Set<string> {
    return this.dead.deadSet()
  }

  /** The excluded or uncalled members inside live POUs, by document URI. */
  deadMembers(): Map<string, Span[]> {
    return this.dead.deadMembers()
  }

  /** Clear the memoized docs() view (the symbol table and the dead caches are kept incrementally, not dropped here). */
  invalidate(): void {
    this.cachedDocs = undefined
  }

  // ─── open-layer mutations (client document sync) ──────────────────────────
  openDocument(uri: string, languageId: string, version: number, text: string): void {
    const key = normalizeKey(uri)
    const before = this.mergedSource(key)
    this.open.set(key, TextDocument.create(uri, languageId, version, text))
    this.openMutated(key, before)
  }

  /** Apply incremental changes to an open document. Returns false if the URI was never opened. */
  changeDocument(uri: string, version: number | null, changes: Parameters<typeof TextDocument.update>[1]): boolean {
    const key = normalizeKey(uri)
    const td = this.open.get(key)
    if (td === undefined) return false
    const before = td.getText()
    this.open.set(key, TextDocument.update(td, changes, version ?? td.version))
    // Drop the parse cache for this doc: an edit changes the text, but a client that reuses/omits the
    // version (`version ?? td.version`) would leave the version-keyed cache returning the pre-edit parse.
    this.cache.delete(key)
    this.openMutated(key, before)
    return true
  }

  /** Drop the open buffer, leaving any disk entry intact so a closed file stays indexed. */
  closeDocument(uri: string): void {
    const key = normalizeKey(uri)
    const before = this.mergedSource(key)
    this.open.delete(key)
    this.cache.delete(key)
    this.failed.delete("open", key) // the buffer that threw is gone; a disk copy's own quarantine stands
    this.openMutated(key, before) // reverts the binding to the disk entry (or drops it if none)
  }

  /** After an open-layer mutation at `key`: bump the generation when the merged text moved, re-merge, rebind. */
  private openMutated(key: string, before: string | undefined): void {
    if (this.mergedSource(key) !== before) this.gen++
    this.invalidate()
    this.rebindKeys([key])
  }

  // ─── disk-layer mutation (eager crawl + watched-file events), keyed by `file://` URI ──
  /** Seed (or reseed) the whole disk layer — the crawl at `initialized`, not the hot path: the project is rebuilt. */
  seedDisk(files: readonly { uri: string; source: string }[]): void {
    this.disk.clear()
    this.failed.clear("disk")
    for (const f of files) {
      const key = normalizeKey(f.uri)
      const doc = this.parseOrQuarantine(key, f.uri, f.source, "disk")
      if (doc !== undefined) this.disk.set(key, doc)
    }
    this.dropProject()
  }

  /** One file's disk entry, new or changed: one parse, one rebind. Equal bytes are free. Whether anything changed. */
  upsertDisk(uri: string, source: string): boolean {
    const key = normalizeKey(uri)
    const current = this.disk.get(key)
    // the same bytes under a new SPELLING (a case-only rename, one key on a case-folding filesystem) are re-parsed
    if (current?.source === source && current.uri === uri) return false
    if (this.failed.has("disk", key, source)) return false
    const doc = this.parseOrQuarantine(key, uri, source, "disk")
    if (doc === undefined) {
      this.disk.delete(key) // never the last good parse: what is on disk now is the content that threw
      return true
    }
    this.disk.set(key, doc)
    this.diskMutated([key])
    return true
  }

  /** One file's disk entry gone. Returns whether there was one. */
  deleteDisk(uri: string): boolean {
    return this.dropDiskKeys([normalizeKey(uri)])
  }

  /** Every disk entry under the folder at `uri` (`folderKey`) gone, but those `kept` names by key (what the disk still
   *  holds, or could not list). Returns whether there was any. */
  deleteDiskUnder(uri: string, kept: (key: string) => boolean): boolean {
    const folder = folderKey(uri)
    const keys = new Set([...this.disk.keys(), ...this.failed.keys("disk")])
    return this.dropDiskKeys([...keys].filter((k) => k.startsWith(folder) && !kept(k)))
  }

  private dropDiskKeys(keys: readonly string[]): boolean {
    let any = false
    for (const key of keys) {
      any = this.failed.delete("disk", key) || any
      any = this.disk.delete(key) || any
    }
    if (any) this.diskMutated(keys)
    return any
  }

  /** Run `apply` — the disk mutations of one watched batch — and rebind everything it moved at once, with ONE relink.
   *  Outside a batch every mutation rebinds on its own. */
  diskBatch(apply: () => void): void {
    if (this.pending !== undefined) throw new Error("WorkspaceStore.diskBatch: a batch is already open")
    const pending = (this.pending = new Set())
    try {
      apply()
    } finally {
      this.pending = undefined
    }
    if (pending.size > 0) this.diskMutated([...pending])
  }

  /** After a disk-layer change at `keys` (deferred to the end of an open `diskBatch`): bump, re-merge, rebind them
   *  together. A file an open buffer hides (a save of an open file) changes nothing analysis sees: no bump, no rebind. */
  private diskMutated(keys: readonly string[]): void {
    if (this.pending !== undefined) {
      for (const key of keys) this.pending.add(key)
      return
    }
    this.invalidate()
    const moved = keys.filter((key) => !this.open.has(key))
    if (moved.length === 0) return
    this.gen++
    this.rebindKeys(moved)
  }

  /** Drop the project scope and the dead caches (rebuilt lazily from the cached parses), and bump the generation. */
  private dropProject(): void {
    this.projectScope = undefined
    this.boundDocs.clear()
    this.dead.reset()
    this.invalidate()
    this.gen++
  }
}
