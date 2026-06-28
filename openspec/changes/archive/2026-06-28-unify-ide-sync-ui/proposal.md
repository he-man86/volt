## Why

The IDE-sync workflow and the git workflow are presented as **two separate UI elements** — in
VS Code a dedicated `⚡` activity-bar view next to the built-in Source Control; in the desktop GUI
a separate "Volt" tab next to Review. They're entangled under the hood (a Volt `push` auto-commits
to git; `pull` is a `git merge`), so showing them apart confuses the user: the same file appears in
two places with two meanings, and Volt actions silently move git state. The IDE axis genuinely
*can't* collapse into git (the IDE changes invisibly to git; only `volt pull` brings it across), so
the fix is not to merge the axes but to **co-locate their presentation** in the host's native
changes UI.

## What Changes

- **VS Code:** present the IDE-sync as a group **inside the native Source Control panel** (Volt as
  a `SourceControl` provider beside Git), retiring the separate `⚡` activity-bar view. Pull/Push/Build
  + incoming/outgoing drift live in that group.
- **Desktop:** add **"IDE"** as a source in the existing session **changes dropdown** (`session.tsx`
  `ChangeMode`), rendering IDE drift through the same review pipeline; surface Pull/Push/Build + health
  alongside it; retire/relocate the separate Volt tab.
- **Keep every control and view** — this is a *placement* change, not a removal. Lean on git/native
  UI; do not rebuild git.

## Capabilities

### Modified Capabilities
- `editor-surface`: the surface is co-located in the host's native changes UI (not a separate panel/tab); controls accompany it.
- `upstream-sync`: the desktop integration likely changes the seam strategy (prefer a generic, upstreamable "diff source" hook over a per-feature edit to `session.tsx`).

## Impact

`volt-vscode` (SCM provider), `volt-app` + the `packages/app` seam (`session-side-panel.tsx`,
`session.tsx` changes-source), `volt-control` (provide the IDE diff list + actions to both renderers).
Touches the upstream merge surface — see design for the seam approach.
