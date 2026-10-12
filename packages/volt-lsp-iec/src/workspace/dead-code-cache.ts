/**
 * The store's DEAD-CODE CACHE (extracted from `workspace-store.ts`, openspec lsp-server-scheduling 2.2): the dead POU
 * set and the dead member spans, kept across edits. The fixpoints are O(project), so they are recomputed ONLY when an
 * edit changes something dead-relevant: `dirty` gates a recompute, and `names`/`snapshot` capture the name universe and
 * per-file reachInfo the current caches reflect, so `afterRebind` can compare the edited file and keep the caches when
 * nothing dead-relevant moved (a within-body edit — the common keystroke).
 */
import type { Span } from "../frontend/syntax/index.js"
import {
  deadMemberSpansFromInfos,
  deadNameUniverse,
  deadPousFromInfos,
  fileReachInfo,
  reachDeadEquivalent,
  type FileReachInfo,
} from "../analysis/index.js"
import type { Document } from "../services/index.js"

/** What the cache reads of its store: the merged documents, the task roots, the dead-code toggle, the key of a URI. */
interface DeadCodeInputs {
  docs(): Document[]
  roots(): ReadonlySet<string> | undefined
  diagnoseDeadCode(): boolean
  keyOf(uri: string): string
}

export class DeadCodeCache {
  private dead: Set<string> | undefined
  private members: Map<string, Span[]> | undefined
  private dirty = true
  private names: ReadonlySet<string> = new Set()
  private snapshot = new Map<string, FileReachInfo>()
  private dcSeen = false // the last-seen diagnoseDeadCode, to catch a config toggle (rare, not per-edit)
  // Per-document dead-code inputs (the lex-heavy part), memoized by Document identity — an edit re-scans only the
  // changed file, not all N. A WeakMap so a replaced Document's info is collected automatically.
  private readonly reach = new WeakMap<Document, FileReachInfo>()

  constructor(private readonly inputs: DeadCodeInputs) {}

  /** Forget everything: the project was rebuilt (a reseed, new references or task roots, a quarantine). */
  reset(): void {
    this.dead = undefined
    this.members = undefined
    this.dirty = true
    this.snapshot.clear()
  }

  /** The memoized reachInfo of one document (a scan of its parse's tokens). */
  private reachOf(d: Document): FileReachInfo {
    let info = this.reach.get(d)
    if (info === undefined) {
      info = fileReachInfo({ uri: d.uri, parseResult: d.parseResult })
      this.reach.set(d, info)
    }
    return info
  }

  private reachInfos(): FileReachInfo[] {
    return this.inputs.docs().map((d) => this.reachOf(d))
  }

  deadSet(): Set<string> {
    const dc = this.inputs.diagnoseDeadCode()
    if (dc !== this.dcSeen) {
      this.dirty = true // a diagnoseDeadCode toggle changes the whole suppression behaviour
      this.dcSeen = dc
    }
    if (dc) return (this.dead = new Set()) // diagnosing dead code ⇒ suppress nothing (overwrite any stale set)
    if (this.dead !== undefined && !this.dirty) return this.dead
    const infos = this.reachInfos()
    this.dead = deadPousFromInfos(infos, this.inputs.roots())
    this.members = undefined // dead set recomputed ⇒ member spans stale
    this.names = deadNameUniverse(infos)
    this.snapshot = new Map(infos.map((i) => [this.inputs.keyOf(i.uri), i]))
    this.dirty = false
    return this.dead
  }

  deadMembers(): Map<string, Span[]> {
    const dead = this.deadSet() // recomputes (and clears the member spans) if reachability changed
    if (this.inputs.diagnoseDeadCode()) return (this.members = new Map()) // overwrite any stale map
    return (this.members ??= deadMemberSpansFromInfos(this.reachInfos(), dead))
  }

  /** After a single-file rebind, mark the caches stale ONLY if that file's reachability actually changed. No-op once
   *  already dirty or before the first dead compute (nothing to compare against). */
  afterRebind(key: string, desired: Document | undefined): void {
    if (this.dirty || this.dead === undefined) return
    const info = desired !== undefined ? this.reachOf(desired) : undefined
    if (!reachDeadEquivalent(this.snapshot.get(key), info, this.names)) this.dirty = true
  }
}
