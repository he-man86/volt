## Why

The desktop/editor IDE-sync surface is shipped across phases **1, 2, 3**: phase 1 extracted
`volt-control` (the UI-agnostic CLI/bridge driver), phase 2 added the persistent "⚡ Volt" tab
to the session panel, phase 3 wired Electron IPC (`window.volt`) so the panel drives the CLI.
It's a deliberately **thin IDE-sync surface**; the git axis delegates to the editor's built-in
Git. Walk it and capture as `desktop-panel` (folds D4, D5).

## What Changes

- Author `specs/desktop-panel/spec.md` — one shared `volt-control` core with two renderers
  (`volt-vscode` + `volt-app`); the surface shows health + Incoming (`VOLTIDE↔BRIDGE`) / Outgoing
  (`VOLTIDE↔WORKSPACE`) drift + the two diffs; history/merge/discard delegate to built-in Git.

## Capabilities

### New Capabilities
- `desktop-panel`: a thin IDE-sync surface (health + incoming/outgoing drift + the two baseline diffs) rendered from one shared `volt-control` core; the git axis is delegated to the editor.

## Impact

Spec/docs only. Touches the already-counted `app` + `desktop` seams (no new seams). Sources: `volt-vscode` + `volt-control` READMEs, D4/D5.
