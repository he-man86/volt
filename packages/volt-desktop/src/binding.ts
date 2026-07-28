// The workspace-binding lifecycle, distilled to a pure decision. The signal is opencode's GUI ROUTE: its project
// pages are `/<base64url(project directory)>/…`, so the page the user is looking at names its own directory —
// verified live (`/QzpcVXNlcnNcbWFyY2VcRG9jdW1lbnRzXFBybzIxOTMtOTQtOTUtOTZfQ09kZXN5cw/session/ses_060a…` decodes to
// `C:\Users\marce\Documents\Pro2193-94-95-96_COdesys`). main.ts feeds this file the view's URL on every navigation
// and applies what it returns. Pure (no electron, no fs) so the lifecycle is unit-tested directly.
//
// This REPLACED a sniff of opencode's HTTP request stream (an `x-opencode-directory` header / `?directory=` query on
// the requests its GUI happened to make). That was indirect and wrong in both directions: the client is constructed
// WITH a directory and keeps stamping it on the home page (so Volt bound — and auto-connected — a project the user
// had never opened), while a project with no session yet emits nothing but `/global/health` (so opening a project
// bound NOTHING until you sent a chat message). The route has neither failure: it changes exactly when the user
// navigates, which is exactly when the binding should change.

/** opencode's active project, as classified from its GUI route:
 *  - `dir`     — the GUI is on a project page, and this is that project's directory.
 *  - `none`    — the GUI is on its home route, i.e. no project selected.
 *  - `unknown` — the initial state, before any navigation (cold start). */
export type ActiveProject = { kind: "dir"; dir: string } | { kind: "none" } | { kind: "unknown" }

// Is `dir` a filesystem root? opencode's `global` worktree is "/". Deliberately a platform-INDEPENDENT string check,
// NOT node:path — `path.resolve()` is platform-dependent, so it would misclassify a Windows drive-root ("C:\") when
// these unit tests run on Linux CI.
const isRootDir = (dir: string): boolean => dir === "/" || dir === "\\" || /^[A-Za-z]:[\\/]?$/.test(dir)

/** Decode one base64url path segment, or undefined if it isn't valid base64url text. */
function decodeSegment(seg: string): string | undefined {
  if (!/^[A-Za-z0-9_-]+=*$/.test(seg)) return undefined
  try {
    const text = Buffer.from(seg.replace(/-/g, "+").replace(/_/g, "/"), "base64").toString("utf8")
    // A wrong guess decodes to mojibake, not a path. Require it to look like one and to round-trip.
    return text.length > 0 && !text.includes("\uFFFD") ? text : undefined
  } catch {
    return undefined
  }
}

/** Classify one GUI URL's pathname into an active-project signal. Pure — the directory check is injected.
 *
 *  Three cases, and only two of them are positive:
 *   - `/`                          → `none`. The home route: no project open. THE release signal.
 *   - `/<base64url(dir)>/…`        → `dir`, when it decodes to a directory that exists. Covers every project page
 *                                    (`/<dir>`, `/<dir>/session/<id>`, drafts) — the prefix is what matters.
 *   - anything else                → `undefined`: tells us nothing, so HOLD the current binding rather than guess.
 *     An unrecognised route (a settings page, a scheme change) must not silently unbind a working workspace. */
export function classifyRoute(pathname: string, exists: (d: string) => boolean): ActiveProject | undefined {
  const first = pathname.split("/").filter(Boolean)[0]
  if (first === undefined) return { kind: "none" } // "/" — opencode's home
  const dir = decodeSegment(first)
  if (dir === undefined || isRootDir(dir) || !exists(dir)) return undefined
  return { kind: "dir", dir }
}

/** What the desktop should do given its current bound root and opencode's active-project signal. The canonical dir
 *  comparison (`same`) is the caller's job (main.ts) — this stays pure. */
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
