// The workspace-binding lifecycle, distilled to a pure decision. opencode's server has NO queryable "current
// project" (verified — see openspec/changes/desktop-connection-flow/observations.md); the ONLY signal is the
// directory it stamps on its requests. main.ts turns that request stream into an ActiveProject and feeds it here;
// this file just decides bind/unbind/hold. Pure (no electron, no fs) so the lifecycle is unit-tested directly.

/** opencode's active project, as classified from its request stream (main.ts `watchActiveProject` → `classifySignal`):
 *  - `dir`     — the GUI is scoped to a real project directory.
 *  - `none`    — the GUI is on opencode's `global`/home scope, i.e. no project selected.
 *  - `unknown` — the initial state, before any signal has arrived (cold start). */
export type ActiveProject = { kind: "dir"; dir: string } | { kind: "none" } | { kind: "unknown" }

// Is `dir` a filesystem root? opencode's `global` worktree is "/". Deliberately a platform-INDEPENDENT string check,
// NOT node:path — `path.resolve()` is platform-dependent, so it would misclassify a Windows drive-root ("C:\") when
// these unit tests run on Linux CI. opencode only ever sends "/" here; the drive-root/UNC cases are cheap insurance.
const isRootDir = (dir: string): boolean => dir === "/" || dir === "\\" || /^[A-Za-z]:[\\/]?$/.test(dir)

/** Pull the two things the binding cares about out of one request: its `pathname` (opencode's home scope is a
 *  `/global/` path prefix) and the opencode-scoped `directory`.
 *
 *  BOTH carriers are load-bearing, and the HTTP METHOD decides which one you get. Read live out of the client
 *  bundle opencode 1.18.3 serves (`/assets/index-*.js`, the exact code our WebContentsView runs):
 *    - at construction the client stamps `x-opencode-directory: encodeURIComponent(dir)` on EVERY request;
 *    - its interceptor early-returns for anything that is not GET/HEAD — so POST/PUT/DELETE (chat sends, session
 *      ops: most traffic while the agent is in use) keep the header and get no query;
 *    - on GET/HEAD it moves the value into `?directory=` and DELETES the header. The moved value is the PLAINTEXT
 *      path: the helper compares the header against the known directory (raw or encodeURIComponent'd) and, on a
 *      match, emits the plain one.
 *  The two are mutually exclusive per request, so the order below is a formality; the header is read first because
 *  it is the client's own construction-time value, while the query is a transform of it. Reading only one carrier
 *  silently halves the signal — that is what deleting the header branch did.
 *
 *  This is CI-checked, not folklore: `verify-opencode.ts`'s wire check (`bun run compat`) spawns a live
 *  `opencode serve`, fetches the bundle it serves, and fails if either the header or that method split is gone.
 *  To watch it live instead, run the desktop with VOLT_BIND_DEBUG=1 — every request logs dir + classification. */
export function parseRequest(url: string, headers: Record<string, string>): { pathname: string; dir: string | undefined } {
  let pathname = ""
  try {
    pathname = new URL(url).pathname
  } catch { /* not a URL */ }
  for (const [k, v] of Object.entries(headers)) {
    if (k.toLowerCase() === "x-opencode-directory" && typeof v === "string" && v.length > 0) {
      try { return { pathname, dir: decodeURIComponent(v) } } catch { return { pathname, dir: v } }
    }
  }
  try {
    return { pathname, dir: new URL(url).searchParams.get("directory") ?? undefined } // searchParams already decodes
  } catch {
    return { pathname, dir: undefined }
  }
}

/** Classify one request's (pathname, directory) into an active-project signal. Pure — the fs check is injected.
 *  VERIFIED against the live opencode client (openspec/changes/desktop-connection-flow/observations.md):
 *   - opencode's HOME / no-project screen is a `/global/` PATH PREFIX (no directory) → `none`.
 *   - a real project rides as `?directory=<path>` (the client deletes the header and re-emits it as this query),
 *     resolving to a real dir → `dir`. A directory that is a filesystem root is the `global` worktree → `none`.
 *   - anything else (no directory, non-`/global/` path — registry endpoints, assets) tells us nothing → undefined. */
export function classifySignal(pathname: string, dir: string | undefined, exists: (d: string) => boolean): ActiveProject | undefined {
  if (pathname.startsWith("/global/")) return { kind: "none" }
  if (dir === undefined) return undefined
  if (isRootDir(dir)) return { kind: "none" }
  if (!exists(dir)) return undefined
  return { kind: "dir", dir }
}

/** What the desktop should do given its current bound root and opencode's active-project signal. The debounce of
 *  `none` and the canonical dir comparison (`same`) are the caller's job (main.ts) — this stays pure. */
export type BindAction = { kind: "bind"; dir: string } | { kind: "unbind" } | { kind: "noop" }

export function bindingAction(
  boundRoot: string | undefined,
  signal: ActiveProject,
  same: (a: string | undefined, b: string | undefined) => boolean,
): BindAction {
  switch (signal.kind) {
    case "unknown":
      return { kind: "noop" } // haven't learned opencode's state yet — hold, don't touch the binding
    case "none":
      return boundRoot === undefined ? { kind: "noop" } : { kind: "unbind" } // left the project → release
    case "dir":
      return same(signal.dir, boundRoot) ? { kind: "noop" } : { kind: "bind", dir: signal.dir }
  }
}
