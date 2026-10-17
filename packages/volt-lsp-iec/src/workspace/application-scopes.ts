/**
 * ONE SCOPE PER APPLICATION (openspec multi-application-tree, design §8; split from `workspace-store.ts`). A workspace
 * that states two or more applications (`WorkspaceRefs.applications`) resolves each document's names in its OWN
 * application's table: that application's documents and libraries, and the POU pool's — the documents under no
 * application. The same GVL in two applications is two globals, one per table, never a C0136 ambiguity. A workspace of
 * one application is the whole project, as before applications were stated.
 *
 * Each table is built lazily and kept incrementally, as the whole project's is: an edit is rebound into the table of its
 * own application and, a pool document, into every one.
 */
import { pathToFileURL } from "node:url"
import { build, type Scope } from "../frontend/symbols/index.js"
import type { Vendor } from "../analysis/index.js"
import type { Document } from "../services/index.js"
import { folderKey, normalizeKey } from "./document-key.js"
import { buildProject } from "./project-build.js"
import type { WorkspaceRefs } from "./workspace-refs.js"

/** What the tables are built from — the store's merged documents and references, read when a table is built. */
interface ScopeSource {
  docs(): Document[]
  refs(): WorkspaceRefs
  vendor(): Vendor
}

export class ApplicationScopes {
  private tables = new Map<string, { scope: Scope; bound: Map<string, Document> }>()

  constructor(private readonly source: ScopeSource) {}

  /** The application roots, as `folderKey`s, longest first — so the first that holds a key is its application. Empty
   *  when the workspace states fewer than two. */
  private roots(): string[] {
    const applications = this.source.refs().applications
    if (applications.length < 2) return []
    return applications.map((a) => folderKey(pathToFileURL(a).href)).sort((a, b) => b.length - a.length)
  }

  /** The application of the document at `uri`, or undefined: the pool, or a workspace of one application. */
  applicationOf(uri: string): string | undefined {
    const key = normalizeKey(uri)
    return this.roots().find((app) => key.startsWith(app))
  }

  /** Whether the document (or manifest) at `uri` is in `app`'s scope: its own, or the pool's. */
  private inScopeOf(app: string, uri: string): boolean {
    const own = this.applicationOf(uri)
    return own === undefined || own === app
  }

  /** The documents in `app`'s scope. */
  documents(app: string): Document[] {
    return this.source.docs().filter((d) => this.inScopeOf(app, d.uri))
  }

  /** The table of `uri`'s application; undefined when it has none (the pool, or one application). */
  tableOf(uri: string): Scope | undefined {
    const app = this.applicationOf(uri)
    return app === undefined ? undefined : this.table(app)
  }

  /** The documents in the scope of `uri`'s application; undefined when it has none (the pool, or one application). */
  documentsOf(uri: string): Document[] | undefined {
    const app = this.applicationOf(uri)
    return app === undefined ? undefined : this.documents(app)
  }

  /** Each application's table, for a document of the POU pool in a workspace of two or more applications — CODESYS
   *  compiles a pool POU in the context of every application (design §8). Undefined for any other document. */
  poolTables(uri: string): Scope[] | undefined {
    const apps = this.roots()
    return apps.length === 0 || this.applicationOf(uri) !== undefined ? undefined : apps.map((app) => this.table(app))
  }

  /** `app`'s table, built when there is none. Built after the whole project's, which quarantined every document whose
   *  bind throws. */
  table(app: string): Scope {
    const built = this.tables.get(app)
    if (built !== undefined) return built.scope
    const docs = this.documents(app)
    const scope = buildProject(docs, this.refsOf(app), this.source.vendor())
    this.tables.set(app, { scope, bound: new Map(docs.map((d) => [normalizeKey(d.uri), d])) })
    return scope
  }

  /** The references `app`'s table binds: the library manifests in its scope. */
  private refsOf(app: string): WorkspaceRefs {
    const refs = this.source.refs()
    return { ...refs, libraryManifests: refs.libraryManifests.filter((m) => this.inScopeOf(app, m.uri)) }
  }

  /** Rebind the documents at `desired` (key → the merged document, undefined when gone) into every built table that
   *  holds them — after the whole project's rebind, which bound each of them already. A key is a normalized path, which
   *  `applicationOf` reads as it reads a URI. */
  rebind(desired: readonly (readonly [string, Document | undefined])[]): void {
    for (const [app, { scope, bound }] of this.tables) {
      const mine = desired.filter(([key, doc]) => this.inScopeOf(app, doc?.uri ?? key))
      if (mine.length === 0) continue
      for (const [key, doc] of mine) {
        const old = bound.get(key)
        if (old !== undefined) build.unbindFile(scope, old.uri)
        if (doc !== undefined) {
          build.bindFile(scope, { uri: doc.uri, parseResult: doc.parseResult, source: doc.source })
          bound.set(key, doc)
        } else {
          bound.delete(key)
        }
      }
      build.relink(scope, this.refsOf(app).libraryManifests)
    }
  }

  /** Every table dropped — rebuilt lazily, as the whole project's is. */
  clear(): void {
    this.tables.clear()
  }
}
