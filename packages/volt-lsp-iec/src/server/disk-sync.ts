/**
 * A WATCHED-FILE BATCH, ONE FILE AT A TIME (openspec lsp-server-scheduling 2.2) — every watched event used to re-crawl
 * and re-parse the whole workspace (7759 files and ~2.1 s blocked per Ctrl+S on pro2193). Now:
 *
 * - a source file is upserted or deleted on its own (`WorkspaceStore.upsertDisk` / `deleteDisk`): one parse;
 * - a reference file (`.library`, `.device`, `.task`, `.projectsettings`) re-scans the references alone, which reads no
 *   source (`scanWorkspaceRefs`) — and so does every DIRECTORY event, since a folder can hold (or have held) one;
 * - a folder a host reports as ONE event: present ⇒ its sources upserted AND every entry under it the disk no longer
 *   holds dropped (a folder removed and re-created — `git checkout`, `volt pull` — arrives as Deleted + Created, or
 *   coalesced as one Changed); gone ⇒ every entry under it dropped. Always at a folder boundary (`POUs/Motor` never
 *   takes `POUs/MotorControl`). A folder under it that cannot be listed keeps its entries, logged and re-read;
 * - a file is deleted only on a FACT — the event says Deleted and the disk agrees, or `stat` answers ENOENT. A Deleted
 *   path the disk still holds is read as Changed, under the spelling the disk has: a case-only rename (`FB_A.pou` →
 *   `fb_a.pou`) is one key on a case-folding filesystem, and its Deleted dropped the file that still exists. Any other
 *   read failure (EBUSY or EPERM while the CLI or the IDE is still writing, common on Windows) keeps the entry, is
 *   logged by name, and is re-read at the next batch — a reference file's too (`ServerState.rescanRefs`). Rejected:
 *   "unreadable counts as deleted" (a guess that leaves a false unresolved error in every caller until the file changes
 *   again).
 *
 * One batch rebinds its files together (`WorkspaceStore.diskBatch`: one relink, not one per file — a `volt pull` of N
 * files cost N × ~33 ms on pro2193) and sends ONE set of refreshes (`afterWorkspaceChange`), none when nothing moved.
 */
import { readdirSync, statSync } from "node:fs"
import { basename, dirname, extname, join } from "node:path"
import { fileURLToPath, pathToFileURL } from "node:url"
import { FileChangeType, type FileEvent } from "vscode-languageserver-protocol/node"
import { SOURCE_EXTENSION_SET } from "../workspace/source-extensions.js"
import { readSourceText, REFERENCE_EXTENSIONS, sourceFilesUnder } from "../workspace/workspace-refs.js"
import { CASE_INSENSITIVE_FS, folderKey, isUnder, normalizeKey } from "../workspace/document-key.js"
import type { Unreadable } from "../workspace/workspace-refs.js"
import type { ServerState } from "./state.js"

const errorCode = (e: unknown): string | undefined => (e as NodeJS.ErrnoException | undefined)?.code
const failure = (path: string, e: unknown): Unreadable => ({ path, code: errorCode(e) ?? String(e) })

/** Apply one `workspace/didChangeWatchedFiles` batch — and first re-read what the last batch could not. */
export function applyWatchedChanges(s: ServerState, changes: readonly FileEvent[]): void {
  if (s.root === undefined) return
  const batch = new Batch(s, s.root)
  const unread = [...s.unread]
  s.unread.clear()
  s.store.diskBatch(() => {
    for (const path of unread) batch.apply(pathToFileURL(path).href, FileChangeType.Changed)
    for (const c of changes) batch.apply(c.uri, c.type)
  })
  const rescanned = (batch.refs || s.refsUnread) && s.rescanRefs()
  if (rescanned || batch.changed) s.afterWorkspaceChange()
}

/** The path as the disk spells it now, or undefined when the disk does not hold it: the exact name, else — on a
 *  case-folding filesystem — the one entry of its folder that differs only in case. Throws when its folder exists and
 *  cannot be listed: whether the path is there is then unknown. */
function presentSpelling(path: string): string | undefined {
  let names: string[]
  try {
    names = readdirSync(dirname(path))
  } catch (e) {
    if (errorCode(e) === "ENOENT") return undefined // its folder is gone too
    throw e
  }
  const name = basename(path)
  if (names.includes(name)) return path
  if (!CASE_INSENSITIVE_FS) return undefined
  const folded = names.find((n) => n.toLowerCase() === name.toLowerCase())
  return folded === undefined ? undefined : join(dirname(path), folded)
}

/** What one batch did: whether the sources moved, and whether the references must be re-scanned. */
class Batch {
  changed = false
  refs = false

  constructor(
    private readonly s: ServerState,
    private readonly root: string,
  ) {}

  apply(uri: string, type: FileChangeType): void {
    let path: string
    try {
      path = fileURLToPath(uri)
    } catch {
      return // not a file: nothing the workspace scan reads
    }
    if (isUnder(uri, pathToFileURL(join(this.root, ".git")).href)) return // the repository `volt init` made, no item
    if (type === FileChangeType.Deleted) {
      let present: string | undefined
      try {
        present = presentSpelling(path)
      } catch (e) {
        return this.unreadable(failure(dirname(path), e))
      }
      if (present === undefined) return this.gone(path, extname(path))
      path = present // still on disk (a case-only rename, a delete then re-create): read as Changed
    }
    const ext = extname(path)
    let directory: boolean
    try {
      directory = statSync(path).isDirectory()
    } catch (e) {
      return errorCode(e) === "ENOENT" ? this.gone(path, ext) : this.unreadable(failure(path, e))
    }
    if (directory) this.folder(path)
    else if (REFERENCE_EXTENSIONS.has(ext)) this.refs = true
    else if (SOURCE_EXTENSION_SET.has(ext)) this.upsert(path)
  }

  private upsert(path: string): void {
    let source: string
    try {
      source = readSourceText(path)
    } catch (e) {
      return errorCode(e) === "ENOENT" ? this.gone(path, extname(path)) : this.unreadable(failure(path, e))
    }
    this.changed = this.s.store.upsertDisk(pathToFileURL(path).href, source) || this.changed
  }

  /** A folder the disk holds: what it holds now, and nothing else. Every entry under it the disk no longer has is
   *  dropped — but under a folder that could not be listed, whose content is unknown; that one is logged and re-read.
   *  The references are re-scanned (a folder can hold, or have held, a reference file). */
  private folder(path: string): void {
    const { files, unlisted } = sourceFilesUnder(path)
    for (const u of unlisted) this.unreadable(u)
    const present = new Set(files.map((f) => normalizeKey(pathToFileURL(f).href)))
    const unknown = unlisted.map((u) => pathToFileURL(u.path).href)
    const kept = (key: string) =>
      present.has(key) || unknown.some((u) => key === normalizeKey(u) || key.startsWith(folderKey(u)))
    this.changed = this.s.store.deleteDiskUnder(pathToFileURL(path).href, kept) || this.changed
    for (const file of files) this.upsert(file)
    this.refs = true
  }

  /** `path` is gone: a source's entry, the references, or — no scanned extension — a folder, when it held a source or
   *  a reference file the last scan read. */
  private gone(path: string, ext: string): void {
    const uri = pathToFileURL(path).href
    if (SOURCE_EXTENSION_SET.has(ext)) this.changed = this.s.store.deleteDisk(uri) || this.changed
    else if (REFERENCE_EXTENSIONS.has(ext)) this.refs = true
    else {
      const held = this.s.store.deleteDiskUnder(uri, () => false)
      this.changed = held || this.changed
      if (held || this.s.refPaths.some((p) => isUnder(pathToFileURL(p).href, uri))) this.refs = true
    }
  }

  /** A read that failed for any reason but ENOENT: no delete — the entry stays, the log names it, the next batch
   *  re-reads it. */
  private unreadable(file: Unreadable): void {
    this.s.logUnreadable(file, "its last state is kept and it is re-read")
    this.s.unread.add(file.path)
  }
}
