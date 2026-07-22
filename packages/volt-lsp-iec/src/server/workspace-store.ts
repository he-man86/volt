/**
 * WorkspaceStore — the live server's document + project state (Layer G, extracted from `server.ts`).
 *
 * Two source layers feed one project symbol table:
 *   - `open`  — `TextDocument`s the client has opened (an unsaved edit still drives analysis).
 *   - `disk`  — parsed source files crawled from the workspace root / delivered by watched-file events.
 * For any file present in both, the open buffer wins (`docs()` merge). Everything is keyed by a
 * normalized URI so an open buffer and its on-disk file collapse to one entry.
 *
 * A per-`(uri, version)` parse cache means an open document is parsed once per version and shared by the
 * symbol-table build and every position query — the pre-extraction closure re-parsed each doc twice.
 */
import { TextDocument } from "vscode-languageserver-textdocument"
import { fileURLToPath } from "node:url"
import { parseSource, type Span } from "../syntax/index.js"
import { buildSymbolTable, bindFile, unbindFile, linkExtends, type Scope } from "../symbols/index.js"
import {
  deadPousFromInfos,
  deadMemberSpansFromInfos,
  fileReachInfo,
  deadNameUniverse,
  reachDeadEquivalent,
  EMPTY_WORKSPACE_REFS,
  type FileReachInfo,
  type ResolvedConfig,
  type WorkspaceRefs,
} from "../analysis/index.js"
import type { Document } from "../services/index.js"

// Windows and macOS default to case-insensitive filesystems; Linux is case-sensitive. Case-fold the key on
// the former so an open buffer and its disk crawl (which may differ in path case) collapse to one entry.
const CASE_INSENSITIVE_FS = process.platform === "win32" || process.platform === "darwin"

/** Collapse a URI to a stable identity key so an open buffer and its disk file are one entry.
 *  ponytail: whole-path case-fold on case-insensitive filesystems — good enough for the drive-letter/case
 *  mismatches a client sends; swap for per-segment folding only if a case-sensitive path ever collides. */
function normalizeKey(uri: string): string {
  try {
    const p = fileURLToPath(uri)
    return CASE_INSENSITIVE_FS ? p.toLowerCase() : p
  } catch {
    return uri
  }
}

interface Parsed {
  version: number
  doc: Document
}

export class WorkspaceStore {
  private open = new Map<string, TextDocument>()
  private disk = new Map<string, Document>()
  private cache = new Map<string, Parsed>() // (key → last parsed open version); survives invalidate()

  // Reference-file catalogs + reachability seeds, refreshed on init and on watched-file events.
  workspaceRefs: WorkspaceRefs = EMPTY_WORKSPACE_REFS
  taskRoots: ReadonlySet<string> | undefined
  config: ResolvedConfig

  private cachedDocs: Document[] | undefined
  // The project symbol table, maintained INCREMENTALLY: built once (lazily), then a single-file edit
  // re-indexes only that file (`rebindKey`) instead of rebuilding the whole table per keystroke. Undefined
  // until first built or after a full disk reseed. `boundDocs` mirrors what is currently bound, keyed like
  // `docs()` (normalized key → the exact Document object bound), so an edit can unbind the old + bind the new.
  private projectScope: Scope | undefined
  private boundDocs = new Map<string, Document>()
  private cachedDead: Set<string> | undefined
  private cachedDeadMembers: Map<string, Span[]> | undefined
  // Dead-code caching across edits: the fixpoints are O(project), so recompute ONLY when an edit actually
  // changes something dead-relevant. `deadDirty` gates a recompute; `deadNames`/`deadInfoSnapshot` capture the
  // name universe + per-file reachInfo the current dead caches reflect, so `rebindKey` can compare the edited
  // file and keep the caches when nothing dead-relevant moved (a within-body edit — the common keystroke).
  private deadDirty = true
  private deadNames: ReadonlySet<string> = new Set()
  private deadInfoSnapshot = new Map<string, FileReachInfo>()
  private deadConfigDc = false // last-seen config.diagnoseDeadCode, to catch a config toggle (rare, not per-edit)
  // Per-document dead-code inputs (the lex-heavy part), memoized by Document identity — an edit re-scans
  // only the changed file, not all N. A WeakMap so a replaced Document's info is collected automatically.
  private reachCache = new WeakMap<Document, FileReachInfo>()

  constructor(config: ResolvedConfig) {
    this.config = config
  }

  /** Parse an open document once per version; reuse the cached parse for the same (uri, version). */
  private openParse(td: TextDocument): Document {
    const key = normalizeKey(td.uri)
    const hit = this.cache.get(key)
    if (hit !== undefined && hit.version === td.version) return hit.doc
    const source = td.getText()
    const doc: Document = { uri: td.uri, source, parseResult: parseSource(source) }
    this.cache.set(key, { version: td.version, doc })
    return doc
  }

  /** The merged source set — disk entries overridden by open buffers (open wins). Memoized per edit. */
  private docs(): Document[] {
    if (this.cachedDocs !== undefined) return this.cachedDocs
    const merged = new Map<string, Document>()
    for (const [key, d] of this.disk) merged.set(key, d)
    for (const td of this.open.values()) merged.set(normalizeKey(td.uri), this.openParse(td))
    return (this.cachedDocs = [...merged.values()])
  }

  project(): Scope {
    if (this.projectScope === undefined) {
      const docs = this.docs()
      this.projectScope = buildSymbolTable(docs)
      this.boundDocs.clear()
      for (const d of docs) this.boundDocs.set(normalizeKey(d.uri), d)
    }
    return this.projectScope
  }

  /** The currently-merged Document for a key (open buffer wins, else disk, else gone) — the bind unit. */
  private mergedDoc(key: string): Document | undefined {
    const td = this.open.get(key)
    if (td !== undefined) return this.openParse(td)
    return this.disk.get(key)
  }

  /** Incrementally re-index a single file after an edit: unbind the old contribution, bind the new, re-link
   *  EXTENDS. No-op until the project has been built once (a pre-query edit just leaves it unbuilt so the
   *  first `project()` builds fresh). O(changed file), not O(project). */
  private rebindKey(key: string): void {
    if (this.projectScope === undefined) return
    const old = this.boundDocs.get(key)
    if (old !== undefined) unbindFile(this.projectScope, old.uri)
    const desired = this.mergedDoc(key)
    if (desired !== undefined) {
      bindFile(this.projectScope, { uri: desired.uri, parseResult: desired.parseResult, source: desired.source })
      this.boundDocs.set(key, desired)
    } else {
      this.boundDocs.delete(key)
    }
    linkExtends(this.projectScope)
    this.markDeadDirtyIfReachChanged(key, desired)
  }

  workspace(): Document[] {
    return this.docs()
  }

  /** The client URIs of currently-open documents (for re-publishing diagnostics after a re-index). */
  openUris(): string[] {
    return [...this.open.values()].map((td) => td.uri)
  }

  /** The parsed document for a URI — open buffer if opened, else the disk crawl, else undefined. */
  doc(uri: string): Document | undefined {
    const key = normalizeKey(uri)
    const td = this.open.get(key)
    if (td !== undefined) return this.openParse(td)
    return this.disk.get(key)
  }

  /** The memoized dead-code reachInfo for one document (lex-heavy; keyed by Document identity, so only a
   *  re-parsed file re-lexes). */
  private reachOf(d: Document): FileReachInfo {
    let info = this.reachCache.get(d)
    if (info === undefined) {
      info = fileReachInfo({ uri: d.uri, source: d.source, parseResult: d.parseResult })
      this.reachCache.set(d, info)
    }
    return info
  }

  /** Per-file dead-code inputs for the merged doc set, reusing memoized infos for unchanged files. */
  private reachInfos(): FileReachInfo[] {
    return this.docs().map((d) => this.reachOf(d))
  }

  deadSet(): Set<string> {
    const dc = this.config.diagnoseDeadCode
    if (dc !== this.deadConfigDc) {
      this.deadDirty = true // a diagnoseDeadCode toggle changes the whole suppression behaviour
      this.deadConfigDc = dc
    }
    if (dc) return (this.cachedDead = new Set()) // diagnosing dead code ⇒ suppress nothing (overwrite any stale set)
    if (this.cachedDead !== undefined && !this.deadDirty) return this.cachedDead
    const infos = this.reachInfos()
    this.cachedDead = deadPousFromInfos(infos, this.taskRoots)
    this.cachedDeadMembers = undefined // dead set recomputed ⇒ member spans stale
    this.deadNames = deadNameUniverse(infos)
    this.deadInfoSnapshot = new Map(infos.map((i) => [normalizeKey(i.uri), i]))
    this.deadDirty = false
    return this.cachedDead
  }

  deadMembers(): Map<string, Span[]> {
    const dead = this.deadSet() // recomputes (and clears cachedDeadMembers) if reachability changed
    if (this.config.diagnoseDeadCode) return (this.cachedDeadMembers = new Map()) // overwrite any stale map
    return (this.cachedDeadMembers ??= deadMemberSpansFromInfos(this.reachInfos(), dead))
  }

  /** After a single-file rebind, mark the dead caches stale ONLY if that file's reachability actually changed
   *  (a within-body edit — the common keystroke — leaves them valid, skipping the O(project) fixpoints). No-op
   *  once already dirty or before the first dead compute (nothing to compare against). */
  private markDeadDirtyIfReachChanged(key: string, desired: Document | undefined): void {
    if (this.deadDirty || this.cachedDead === undefined) return
    const newInfo = desired !== undefined ? this.reachOf(desired) : undefined
    if (!reachDeadEquivalent(this.deadInfoSnapshot.get(key), newInfo, this.deadNames)) this.deadDirty = true
  }

  /** Clear the merged-doc-list cache. The symbol table + dead caches are maintained incrementally (rebindKey /
   *  the deadDirty gate), so they are NOT dropped here — only the memoized docs() view. */
  invalidate(): void {
    this.cachedDocs = undefined
  }

  // ─── open-layer mutations (client document sync) ──────────────────────────
  openDocument(uri: string, languageId: string, version: number, text: string): void {
    const key = normalizeKey(uri)
    this.open.set(key, TextDocument.create(uri, languageId, version, text))
    this.invalidate()
    this.rebindKey(key)
  }

  /** Apply incremental changes to an open document. Returns false if the URI was never opened. */
  changeDocument(uri: string, version: number | null, changes: Parameters<typeof TextDocument.update>[1]): boolean {
    const key = normalizeKey(uri)
    const td = this.open.get(key)
    if (td === undefined) return false
    this.open.set(key, TextDocument.update(td, changes, version ?? td.version))
    // Drop the parse cache for this doc: an edit changes the text, but a client that reuses/omits the
    // version (`version ?? td.version`) would leave the version-keyed cache returning the pre-edit parse.
    this.cache.delete(key)
    this.invalidate()
    this.rebindKey(key)
    return true
  }

  /** Drop the open buffer, leaving any disk entry intact so a closed file stays indexed. */
  closeDocument(uri: string): void {
    const key = normalizeKey(uri)
    this.open.delete(key)
    this.cache.delete(key)
    this.invalidate()
    this.rebindKey(key) // reverts the binding to the disk entry (or drops it if none)
  }

  // ─── disk-layer mutation (eager crawl + watched-file events), keyed by `file://` URI ──
  /** Seed (or reseed) the whole disk layer from a source crawl. A wholesale reseed drops the incremental
   *  project so the next `project()` rebuilds it fresh — this is the init/watched-file path, not the hot one. */
  seedDisk(files: readonly { uri: string; source: string }[]): void {
    this.disk.clear()
    for (const f of files)
      this.disk.set(normalizeKey(f.uri), { uri: f.uri, source: f.source, parseResult: parseSource(f.source) })
    this.projectScope = undefined
    this.boundDocs.clear()
    this.cachedDead = undefined // wholesale reseed ⇒ the dead caches + their snapshot are stale
    this.cachedDeadMembers = undefined
    this.deadDirty = true
    this.deadInfoSnapshot.clear()
    this.invalidate()
  }
}
