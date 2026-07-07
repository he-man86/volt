## Why

The Volt editor surface lives *inside* the host's git UI: in VS Code it is a native `SourceControl`
group beside Git; in the desktop GUI it is a `VoltIdePanel` mounted in the session view. That
framing treats IDE-sync as "another kind of git," but Volt is a product surface in its own right —
sync, bridge health, language reference, the agent, and (increasingly) live LSP diagnostics. Cramming
it beside git buries the actionable controls and gives the growing set of non-version-control features
no home. Separately, the VS Code extension has drifted from the current `volt-lsp-iec`: `lsp.ts` reads
config under `volt.lsp.*` while the manifest only declares `volt.structuredText.*`, so the client
reads keys that do not exist and ignores the ones that do (including the server-path override). Now is
the moment because the LSP is feature-complete enough that its diagnostics are worth surfacing to the
user, not just the agent.

## What Changes

- **BREAKING (spec):** Give Volt its own dedicated area instead of co-locating in the host's git UI —
  on **both** surfaces. This reverses `editor-surface`'s current requirement that the IDE-sync surface
  live in the native changes UI and never behind a separate activity-bar icon/tab.
- **VS Code — dedicated activity-bar "Volt" view container** with:
  - **IDE Sync** — the Incoming/Outgoing drift groups + Pull/Push/Force-Pull/Force-Push/Build actions,
    moved out of the native `SourceControl` group. Click-to-diff against the `refs/remotes/volt/ide`
    baseline is preserved.
  - **Bridge status** — connection health (connected / degraded / offline / unreachable), project
    binding, and port, with the Start-Bridge / Accept-Rename actions. Today this only lives in the
    status bar.
  - **Reference & Agent** — the CODESYS language-reference entry + Open Agent / New Session launchers,
    today only palette commands.
  - A lightweight **Diagnostics summary** row — "N errors, M warnings" grouped per file — that **jumps
    to the pre-filtered native Problems panel**. Not a custom diagnostics tree: the `LanguageClient`
    already publishes LSP diagnostics to the Problems panel for free, so a bespoke tree would reinvent
    it. This gives the user code errors without opening CODESYS.
- **VS Code — LSP wiring brought up to date** with the current `volt-lsp-iec`: read the declared config
  keys (the client was reading a nonexistent `volt.lsp.*` namespace), honor the server-path override,
  launch the stdio-only server correctly (`--stdio` + vendor flag, robust module resolution), and forward
  `diagnostics.*` + `vendor` + `trace` into the server `initializationOptions`.
- **Drop legacy LSP product naming (`structuredText`/`lsp-st` → `iec`).** Rename the LSP's config
  namespace `volt.structuredText.*` → `volt.iec.*` (it's the IEC LSP, covering ST *and* VG — not one
  language), and fix the stale `lsp-st` reference in `CLAUDE.md`. **Keep** the `structured-text` language
  id and "Structured Text" labels — ST is a genuine IEC 61131-3 language, not legacy naming.
- **Desktop GUI** — move the IDE-sync surface out of the session view into its own dedicated area
  (activity/nav home), adjusting the existing `<VoltIdePanel/>` seam in `session.tsx` rather than
  adding a new one.
- The status-bar aggregate item (worst-state-wins) **stays** as the ambient global indicator; the
  dedicated view is the actionable surface it points into.
- Purely additive to opencode: all product code stays in `packages/volt-*`. The VS Code side is
  fork-owned (no upstream-seam cost). The desktop side reuses the already-seamed `session.tsx` line.

## Capabilities

### New Capabilities
<!-- none — this reshapes the existing editor-surface capability -->

### Modified Capabilities
- `editor-surface`: The "IDE axis sits beside git" and "IDE-sync surface is co-located in the host's
  native changes UI" requirements are **replaced** with a dedicated-Volt-area requirement (VS Code
  activity-bar container; desktop dedicated area). Add requirements for the Bridge-status view, the
  Reference & Agent view, and the Diagnostics-summary-that-jumps-to-Problems row. Add a requirement
  that the extension's LSP client reads the declared `volt.structuredText.*` configuration (override +
  diagnostics toggles + vendor + trace) and forwards it to the server.

## Impact

- **`packages/volt-vscode`** — `package.json` (new `viewsContainers` + `views`, move `scm/title` menus
  to `view/title`, reconcile `configuration` keys); `src/views/scm.ts` → tree/webview-backed views;
  `src/lsp.ts` (config namespace + override + init options); `src/extension.ts` (wire the new views);
  `src/state/status.ts` unchanged in shape (still the status source).
- **`packages/volt-app` + `packages/app`** — relocate `VoltIdePanel` to its own area; the
  `packages/app/src/pages/session.tsx` seam line moves rather than being added (still one seam).
- **`@opencode-ai/volt-control`** — unchanged core; both surfaces keep rendering it.
- **Spec** — `openspec/specs/editor-surface/spec.md` requirements change (see Modified Capabilities).
- No new dependency. No change to the bridge, the CLI wire, or `volt-lsp-iec` itself (only how the
  extension configures and consumes it).
