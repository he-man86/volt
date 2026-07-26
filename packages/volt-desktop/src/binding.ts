// The workspace-binding lifecycle, distilled to a pure decision. opencode's server has NO queryable "current
// project" (verified — see openspec/changes/desktop-connection-flow/observations.md); the ONLY signal is the
// directory it stamps on its requests. main.ts turns that request stream into an ActiveProject and feeds it here;
// this file just decides bind/unbind/hold. Pure (no electron, no fs) so the lifecycle is unit-tested directly.

/** opencode's active project, as classified from its request stream (main.ts `classifyActiveProject`):
 *  - `dir`     — the GUI is scoped to a real project directory.
 *  - `none`    — the GUI is on opencode's `global`/home root, i.e. no project selected.
 *  - `unknown` — the initial state, before any signal has arrived (cold start). */
export type ActiveProject = { kind: "dir"; dir: string } | { kind: "none" } | { kind: "unknown" }

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
