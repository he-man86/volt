/**
 * WHICH VENDOR THIS SERVER SPEAKS — decided ONCE, at `initialize` (openspec lsp-same-standard design §7).
 *
 * The vendors are identical on the Volt layer: their difference is data read from one fact, and this is where that fact
 * is decided. The binding of the first BOUND workspace folder (`workspace/binding.ts`) — which is also the folder crawled —
 * else the client's flag (`--codesys|--twincat`), else a refusal by name; a flag that contradicts the binding is refused
 * naming both — never a guessed dialect, which gives wrong answers rather
 * than missing ones. The Claude Code plugin launches `--stdio` with no flag (one static entry cannot know a workspace's
 * vendor), so the binding is what makes a TwinCAT workspace TwinCAT there.
 */
import { fileURLToPath } from "node:url"
import type { InitializeParams } from "vscode-languageserver-protocol/node"
import type { Vendor } from "../analysis/index.js"
import { boundVendor } from "../workspace/binding.js"

/** A `file://` URI as a path, or undefined for any other scheme. */
function pathOf(uri: string): string | undefined {
  try {
    return fileURLToPath(uri)
  } catch {
    return undefined
  }
}

/** The workspace root as a filesystem path: a `file://` `rootUri` (preferred), else `rootPath`. */
function workspaceRoot(params: Pick<InitializeParams, "rootUri" | "rootPath">): string | undefined {
  const fromUri = params.rootUri != null && params.rootUri.length > 0 ? pathOf(params.rootUri) : undefined
  if (fromUri !== undefined) return fromUri
  return params.rootPath != null && params.rootPath.length > 0 ? params.rootPath : undefined
}

/** The folders the client opened, in its order: `workspaceFolders`, else the root. */
function openedFolders(params: InitializeParams): string[] {
  const folders = (params.workspaceFolders ?? []).flatMap((f) => pathOf(f.uri) ?? [])
  if (folders.length > 0) return folders
  const root = workspaceRoot(params)
  return root === undefined ? [] : [root]
}

/**
 * What the server serves — the vendor it speaks and the folder it crawls (none: the open buffers are the project) —
 * decided together so they cannot come from two folders: the first bound
 * folder is the one crawled and its binding is the vendor (a flag that names another vendor is a conflict, refused
 * naming both — never one silently preferred). No bound folder: the flag and the client's root. Neither ⇒ throws,
 * naming both ways to state one.
 */
export function servedWorkspace(flag: Vendor | undefined, params: InitializeParams): { vendor: Vendor; root: string | undefined } {
  for (const folder of openedFolders(params)) {
    const bound = boundVendor(folder)
    if (bound === undefined) continue
    if (flag !== undefined && flag !== bound)
      throw new Error(`vendor conflict: the server was started with --${flag}, but ${folder} is bound to ${bound} (its .git/volt/config.json) — start it with --${bound} or no flag, or re-bind the folder`)
    return { vendor: bound, root: folder }
  }
  if (flag !== undefined) return { vendor: flag, root: workspaceRoot(params) }
  throw new Error("no vendor: no workspace folder is bound — run `volt init --vendor <codesys|twincat>`, or start the server with --codesys|--twincat")
}
