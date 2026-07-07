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
import { buildSymbolTable, type Scope } from "../symbols/index.js"
import {
  deadPous,
  deadMemberSpans,
  EMPTY_WORKSPACE_REFS,
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
  private cachedProject: Scope | undefined
  private cachedDead: Set<string> | undefined
  private cachedDeadMembers: Map<string, Span[]> | undefined

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
    return (this.cachedProject ??= buildSymbolTable(this.docs()))
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

  deadSet(): Set<string> {
    return (this.cachedDead ??= this.config.diagnoseDeadCode ? new Set() : deadPous(this.workspace(), this.taskRoots))
  }

  deadMembers(): Map<string, Span[]> {
    return (this.cachedDeadMembers ??= this.config.diagnoseDeadCode
      ? new Map()
      : deadMemberSpans(this.workspace(), this.deadSet()))
  }

  invalidate(): void {
    this.cachedDocs = undefined
    this.cachedProject = undefined
    this.cachedDead = undefined
    this.cachedDeadMembers = undefined
  }

  // ─── open-layer mutations (client document sync) ──────────────────────────
  openDocument(uri: string, languageId: string, version: number, text: string): void {
    this.open.set(normalizeKey(uri), TextDocument.create(uri, languageId, version, text))
    this.invalidate()
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
    return true
  }

  /** Drop the open buffer, leaving any disk entry intact so a closed file stays indexed. */
  closeDocument(uri: string): void {
    const key = normalizeKey(uri)
    this.open.delete(key)
    this.cache.delete(key)
    this.invalidate()
  }

  // ─── disk-layer mutation (eager crawl + watched-file events), keyed by `file://` URI ──
  /** Seed (or reseed) the whole disk layer from a source crawl. */
  seedDisk(files: readonly { uri: string; source: string }[]): void {
    this.disk.clear()
    for (const f of files)
      this.disk.set(normalizeKey(f.uri), { uri: f.uri, source: f.source, parseResult: parseSource(f.source) })
    this.invalidate()
  }
}
