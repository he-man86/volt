# volt-vscode

> The VS Code / Windsurf extension for PLC code — Structured Text **and the VG graphical language** intelligence, plus one-click sync with your live PLC IDE.

Volt turns the source inside a running CODESYS or TwinCAT/Beckhoff project into ordinary, editable files in your editor. You get Structured Text (IEC 61131-3) syntax highlighting and full language intelligence — hover, go-to-definition, completion, diagnostics — over `.st` and the related PLC file kinds, and a dedicated **Volt** activity-bar view that shows how your workspace and the IDE have diverged and lets you pull, push, and merge between them.

## Role in Volt

This package is Volt's **editor front-end** — the layer an engineer actually looks at. It ships self-contained: the build bundles the `volt-git` CLI into `dist/cli.js`, and the extension points its CLI calls at that bundled binary via `setBundledCli()` (from `@opencode-ai/volt-control`), so no per-workspace Node install is needed. Language intelligence comes from the `volt-lsp-st` server, started as an LSP client.

The heart of the UI is the **`volt.scm`** tree view ("Sync with IDE"). It renders, per workspace:

- a **health** row (connected / degraded / disconnected / unreachable to the bridge), and
- two drift groups — **Incoming (IDE → pull)** and **Outgoing (push → IDE)** — each file a clickable `vscode.diff` against the last-synced baseline ref `refs/remotes/volt/ide` (`VOLTIDE`).

Git history, conflict resolution, and discard are **delegated to the editor's built-in Git** — when a pull hits conflicts, Volt opens the files and tells you to resolve them with your normal merge tools, then pull again. Volt owns only the IDE axis git can't see; it adds no custom history or merge engine.

## How it works

**Activation.** The extension activates on `onStartupFinished`, on opening any registered PLC language (`.st`, `.itf`, `.gvl`, the DUT kinds, …), and on a workspace that contains matching PLC files. On activation it scans each workspace folder for `.git/volt/config.json` (`hasVoltConfig`); a folder with that file is registered as a live Volt workspace, which lights up the SCM view, the status bar, and file decorations without a reload. The `volt.workspaceInitialized` context key gates the welcome view vs. the SCM toolbar.

**Status tracking** (`state/status.ts`). Each workspace gets a `VoltStatus` that probes bridge health every 30s, polls the Volt state mtime every 3s, refreshes on save of tracked POU files, and runs `volt status --json` (via `fetchStatus` in `@opencode-ai/volt-control`) to populate the cached `StatusJson`. On error it keeps the last good status and just surfaces the message.

**The SCM tree** (`views/scm.ts`). Incoming items diff `VOLTIDE ↔ BRIDGE` (the baseline vs. the live IDE — what a pull brings in); outgoing items diff `VOLTIDE ↔ WORKSPACE` (the baseline vs. your working file — what a push sends). A project mismatch or an in-progress merge short-circuits the tree to a single explanatory row.

**Diff content** (`providers/content.ts`). A `volt://` text-document content provider backs every diff: it parses the `volt://<workspaceRoot>/<ref>/<path>` URI and shells out to `volt show <ref> <path>` (via `spawnVoltBuffer`) to materialize that ref's version of a file. Exit code 2 (absent) renders as empty so adds/deletes diff cleanly.

**Drift decorations** (`providers/decorations.ts`). A file-decoration provider badges changed files in the Explorer: `i` (incoming, `volt.driftIncomingForeground`), `o` (outgoing, `volt.driftOutgoingForeground`), `C` (merge conflict, `volt.driftConflictForeground`), and `RO` for read-only kinds (graphical/config files the AI reads but can't push, from `extensionAccess`). These colors are deliberately distinct from git's own.

**The language client** (`lsp.ts`). One `LanguageClient` ("Volt LSP") is started over stdio for the ST-family language ids, resolving the server module from the bundled `@opencode-ai/volt-lsp` (falling back to the sibling `volt-lsp-st` workspace build). Editable FBD/LD bodies are their **own** `volt-graphical` (VG) language — Volt's ST-flavored graphical language; it's highlighted with the ST TextMate grammar (VG reads like ST) but the server routes it to its dedicated VG analysis by the leading `NETWORK` token. Read-only `.cfc/.sfc` stay on `structured-text`. `Volt: Restart Language Server` and `Volt: Show Language Server Output` drive it.

**Status bar + Start Bridge** (`extension.ts`). A single status-bar item aggregates all workspaces (worst-state-wins): merge in progress, bridge offline, no project, degraded, `N↑ M↓` drift, or in-sync. When the bridge is offline the item retargets to **`volt.startBridge`**, which (via `connector.ts`) ensures the Volt Connector is running and starts the configured bridge port. Onboarding (`volt.setup`) asks the connector which IDE/project is live and binds to it directly, falling back to an explicit TwinCAT/CODESYS pick.

## Commands

Build and package from the package directory (`packages/volt-vscode`):

```bash
# Type-check, then bundle the extension, the LSP server, and the volt CLI into dist/.
bun run build

# Build, then produce a .vsix marketplace package (vsce, no dependency tree).
bun run package
```

`package` runs `vsce package --no-dependencies`, producing `volt-<version>.vsix`. Reinstalling the **same** version string is a no-op for VS Code, so bump `version` in `package.json` before each rebuild you intend to install.

Install the packaged extension into VS Code or Windsurf:

```bash
code     --install-extension volt-<version>.vsix
windsurf --install-extension volt-<version>.vsix
```

## Layout

| Path | Role |
|---|---|
| `src/extension.ts` | `activate`/`deactivate`; wires the SCM tree, decorations, content provider, status bar, per-workspace `VoltStatus`, and `setBundledCli`; starts the LSP. |
| `src/commands.ts` | All `volt.*` command handlers — pull/push (with force confirmations), init/setup, build, status, refresh, start-bridge, open config/settings/reference. |
| `src/views/scm.ts` | The `volt.scm` tree: health row + Incoming/Outgoing drift groups, each item a `vscode.diff` against `refs/remotes/volt/ide`. |
| `src/providers/content.ts` | `volt://` content provider; resolves a ref's file via `volt show`. |
| `src/providers/decorations.ts` | Explorer drift badges (`i`/`o`/`C`/`RO`) using the `volt.drift*` theme colors. |
| `src/state/status.ts` | `VoltStatus` — health probe, mtime poll, `volt status --json` refresh, config detection. |
| `src/lsp.ts` | Starts the Volt LSP client for the ST-family languages. |
| `src/connector.ts` | Talks to the Volt Connector (bridge discovery, start-bridge, CODESYS/TwinCAT instance selection). |
| `languages/structured-text/` | TextMate grammar (`syntax.tmLanguage.json`) + language configuration, reused by ST, **VG** (`volt-graphical`), ITF/GVL/DUT. |
| `icons/` | File-kind icons and the `volt-icons` icon theme + activity-bar icon. |

## See also

- [`../volt-control/README.md`](../volt-control/README.md) — the shared TS control layer (`pull`/`push`/`status`/`show`, health, gates) the extension calls.
- [`../volt-git/README.md`](../volt-git/README.md) — the `volt` CLI bundled into `dist/cli.js`.
- [`../volt-lsp-st/README.md`](../volt-lsp-st/README.md) — the Structured Text **+ VG** language server.
- [`../volt-bridge/docs/vg-language.md`](../volt-bridge/docs/vg-language.md) — the **VG (Volt Graphical)** language spec.
- [`../../VOLT-DESIGN.md`](../../VOLT-DESIGN.md) — Volt design, roadmap, and decision log.
- [`../../CLAUDE.md`](../../CLAUDE.md) — repo-wide guidance and the fork's architecture.
