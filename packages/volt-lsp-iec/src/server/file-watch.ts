/**
 * THE WATCHER FALLBACK (openspec lsp-server-scheduling 2.5) — a client without dynamic `didChangeWatchedFiles`
 * registration never reports a disk change, so after a `volt pull` such a host would stay stale until restarted. The
 * server then watches the root itself: a recursive `fs.watch` feeds the same path a client's batch takes
 * (`applyWatchedChanges`). `fs.watch` says only `rename` or `change`, so every path goes in as Changed and the batch's
 * `stat` decides (ENOENT is the delete, a directory is a folder event). It fires several times per save, so its events
 * are coalesced per macrotask into ONE batch (one flush, one refresh set); equal bytes cost a read and no parse
 * (`upsertDisk`). `.git` is skipped. Rejected: documenting the gap.
 */
import { watch, type FSWatcher } from "node:fs"
import { join, sep } from "node:path"
import { pathToFileURL } from "node:url"
import { FileChangeType, MessageType, type FileEvent } from "vscode-languageserver-protocol/node"
import { applyWatchedChanges } from "./disk-sync.js"
import type { ServerState } from "./state.js"

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
  let watcher: FSWatcher
  try {
    watcher = watch(root, { recursive: true }, (_event, name) => {
      if (name == null) return // Bun on Linux passes undefined, Windows null
      const rel = name.toString()
      if (rel === ".git" || rel.startsWith(`.git${sep}`) || rel.startsWith(".git/")) return
      pending.add(join(root, rel))
      if (!scheduled) {
        scheduled = true
        setImmediate(flush)
      }
    })
  } catch (e) {
    return s.log(MessageType.Error, `volt-lsp-iec: cannot watch ${root} (${String(e)}); disk changes reach the server only at its next start`)
  }
  watcher.on("error", (e) => {
    s.log(MessageType.Error, `volt-lsp-iec: the watch on ${root} failed (${String(e)}); disk changes reach the server only at its next start`)
    watcher.close()
  })
  watcher.unref()
  s.stops.push(() => watcher.close())
}
