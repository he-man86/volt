/**
 * THE WATCHER FALLBACK (openspec lsp-server-scheduling 2.5) — a client without dynamic `didChangeWatchedFiles`
 * registration never reports a disk change, so after a `volt pull` such a host would stay stale until restarted. The
 * server then watches the root itself: a recursive `fs.watch` feeds the same path a client's batch takes
 * (`applyWatchedChanges`). `fs.watch` says only `rename` or `change`, so every path goes in as Changed and the batch's
 * `stat` decides (ENOENT is the delete, a directory is a folder event). It fires several times per save, so its events
 * are coalesced per macrotask into ONE batch (one flush, one refresh set); equal bytes cost a read and no parse
 * (`upsertDisk`). `.git` is skipped. Rejected: documenting the gap.
 *
 * On Linux, Bun's directory watch reports a file's create but not its writes: those come from a watch Bun puts on the
 * new file a moment later, and a write inside that moment fires nothing (a `volt pull` or an editor writing a file it
 * just created; 7 in 10 at 1 ms, measured in WSL). So every file a `rename` names there gets its own watch at once, in
 * the event's callback, and the flush that follows reads the file: a write before that watch is in that read, a write
 * after it fires that watch.
 */
import { statSync, watch, type FSWatcher } from "node:fs"
import { join, sep } from "node:path"
import { pathToFileURL } from "node:url"
import { FileChangeType, MessageType, type FileEvent } from "vscode-languageserver-protocol/node"
import { applyWatchedChanges } from "./disk-sync.js"
import type { ServerState } from "./state.js"

/** Whether a created file needs its own watch for its writes to be seen (see the header). */
const CREATED_FILES_NEED_A_WATCH = process.platform === "linux"

/** Watch the workspace root and feed every change to the store, until the server ends. */
export function watchWorkspace(s: ServerState): void {
  const root = s.root
  if (root === undefined) return
  const pending = new Set<string>()
  let scheduled = false
  const flush = () => {
    scheduled = false
    const changes = [...pending].map((path): FileEvent => ({ uri: pathToFileURL(path).href, type: FileChangeType.Changed }))
    pending.clear()
    applyWatchedChanges(s, changes)
  }
  const changed = (path: string) => {
    pending.add(path)
    if (!scheduled) {
      scheduled = true
      setImmediate(flush)
    }
  }
  const files = new Map<string, FSWatcher>() // the created files' own watches (Linux)
  /** `path` was created, deleted or renamed: its own watch now follows the file the path names now, if any. */
  const rewatch = (path: string) => {
    files.get(path)?.close()
    files.delete(path)
    try {
      if (!statSync(path).isFile()) return
      const w = watch(path, () => changed(path))
      w.on("error", () => (w.close(), files.delete(path))) // the file went; the root's watch reports that
      w.unref()
      files.set(path, w)
    } catch (e) {
      // ENOENT: gone again — the flush reads that as the delete. Any other failure leaves its writes unseen: say so.
      if (!(e instanceof Error && "code" in e && e.code === "ENOENT"))
        s.log(MessageType.Error, `volt-lsp-iec: cannot watch ${path} (${String(e)}); its next writes may go unseen`)
    }
  }
  let watcher: FSWatcher
  try {
    watcher = watch(root, { recursive: true }, (event, name) => {
      if (name == null) return // Bun on Linux passes undefined, Windows null
      const rel = name.toString()
      if (rel === ".git" || rel.startsWith(`.git${sep}`) || rel.startsWith(".git/")) return
      const path = join(root, rel)
      if (CREATED_FILES_NEED_A_WATCH && event === "rename") rewatch(path)
      changed(path)
    })
  } catch (e) {
    return s.log(MessageType.Error, `volt-lsp-iec: cannot watch ${root} (${String(e)}); disk changes reach the server only at its next start`)
  }
  watcher.on("error", (e) => {
    s.log(MessageType.Error, `volt-lsp-iec: the watch on ${root} failed (${String(e)}); disk changes reach the server only at its next start`)
    watcher.close()
  })
  watcher.unref()
  s.stops.push(() => {
    watcher.close()
    for (const w of files.values()) w.close()
  })
}
