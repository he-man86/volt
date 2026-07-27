# volt-vscode

> The VS Code / Windsurf extension for PLC code — Structured Text **and the VG graphical language** intelligence, plus one-click sync with your live PLC IDE.

Volt turns the source inside a running CODESYS or TwinCAT/Beckhoff project into ordinary, editable files in your editor. You get Structured Text (IEC 61131-3) syntax highlighting and full language intelligence — hover, go-to-definition, completion, diagnostics — over the kind-named PLC source files (`.fb`/`.prg`/`.fun`/`.itf`/`.dut`/`.gvl`), and a dedicated **Volt** activity-bar view that shows how your workspace and the IDE have diverged and lets you pull, push, and merge between them.

## Role in Volt

This package is Volt's **editor front-end** — the layer an engineer actually looks at. The `volt` CLI is the shipped C# binary the Volt installer puts on `PATH`; the extension does **not** bundle it (a per-platform native exe is too heavy for a Marketplace `.vsix`), so `@volt/control` resolves `volt` from `PATH`. Language intelligence comes from the `volt-lsp-iec` server, bundled into `dist/lsp-server.js` and started as an LSP client — that part needs no external install.

The UI is the **Volt** activity-bar container, which hosts four tree views (`src/panel.ts`), per workspace, in this order:

- **IDE Connection** (`volt.views.bridge`) — **the whole connection lifecycle, and the first view in the container**: the detected PLC projects **by name** (click one to set this folder up against it), then once bound the live health row and exactly one action — **Connect** or **Disconnect**, never both, never neither. The tray is never required. It still never *starts* a bridge (that's the connector's job); it selects, connects and disconnects one.
- **IDE Sync** (`volt.views.sync`) — **only "what changed"**: two drift groups, **Incoming (IDE → pull)** and **Outgoing (push → IDE)**, each file a clickable `vscode.diff` against the last-synced baseline ref `refs/remotes/volt/ide` (`VOLTIDE`). Its welcomes never offer init/connect — they point at IDE Connection above, so connection state is described in exactly one place.
- **Diagnostics** (`volt.views.diagnostics`) — the current build/LSP problems.
- **Reference & Agent** (`volt.views.reference`) — links into the language reference + the agent.

Git history, conflict resolution, and discard are **delegated to the editor's built-in Git** — when a pull hits conflicts, Volt opens the files and tells you to resolve them with your normal merge tools, then pull again. Volt owns only the IDE axis git can't see; it adds no custom history or merge engine.

## How it works

**Activation.** The extension activates on `onStartupFinished`, on opening the Structured Text language (every writable source item — POU/DUT/GVL/interface, textual or editable graphical — is one kind-named file (`.fb`/`.prg`/`.fun`/`.itf`/`.dut`/`.gvl`, every DUT one `.dut`); read-only `.cfc`/`.sfc` and reference manifests keep their own extensions), and on a workspace that contains matching PLC files. On activation it scans each workspace folder for `.git/volt/config.json` (`hasVoltConfig`); a folder with that file is registered as a live Volt workspace, which lights up the IDE Connection + IDE Sync views and file decorations without a reload. The `volt.workspaceInitialized` context key gates the welcome view vs. the view toolbar. **The bridge connection follows the active project view** (shared `@volt/control` lifecycle with the desktop, over the `connector-session-model`): registering a workspace **declares an interest** in its bound project (`enterWorkspace`), and removing the folder / `deactivate` (window close) **drops** it (`leaveWorkspace`; `deactivate` also `shutdownSession()`s the whole session, folded into the returned thenable so the editor waits). The connector serves a project iff ≥1 live session wants it, so two windows on the same project no longer disconnect each other. Manual Connect/Disconnect stay as an override (Disconnect drops *this window's* interest — "stop syncing this project here").

**Status tracking** (`@volt/control`'s `state/status.ts` — not a file in this package). Each workspace gets a `VoltStatus` that polls the connector for this workspace's connection state every 4s (the same read also detects IDE-side edits from a `projectDirty` edge), polls the Volt state mtime every 3s, refreshes on save of tracked POU files, and runs `volt status --json` (via `fetchStatus`) to populate the cached `StatusJson`. On error it keeps the last good status and just surfaces the message.

**The views** (`panel.ts`). In IDE Sync, incoming items diff `HEAD ↔ BRIDGE` (your repo's last commit vs. the live IDE — what a pull brings in; **not** `VOLTIDE ↔ BRIDGE`, which after any pull is two identical panes since `refs/remotes/volt/ide` *is* the IDE); outgoing items diff `VOLTIDE ↔ WORKSPACE` (the last-synced baseline vs. your working file — what a push sends). A project mismatch or an in-progress merge short-circuits the tree to a single explanatory row.

**Diff content** (`content.ts`). A `volt://` text-document content provider backs every diff: it parses the `volt://<workspaceRoot>/<ref>/<path>` URI and shells out to `volt show <ref> <path>` (via `runVolt` with `binary: true`) to materialize that ref's version of a file. Exit code 2 (absent) renders as empty so adds/deletes diff cleanly.

**Drift decorations** (`decorations.ts`). A file-decoration provider badges changed files in the Explorer: `i` (incoming, `volt.driftIncomingForeground`), `o` (outgoing, `volt.driftOutgoingForeground`), `C` (merge conflict, `volt.driftConflictForeground`), and `RO` for **read-only config kinds only** — opaque items the AI reads but can't push (library manager, task config, visualization), from `extensionAccess`. Editable graphical (CFC/FBD/LD) POUs are **not** read-only and are never badged `RO`. Build-excluded objects are omitted by the bridge, so they never reach the workspace to badge. These colors are deliberately distinct from git's own axis.

**The language client** (`lsp.ts`). One `LanguageClient` ("Volt LSP") is started over stdio for the ST-family language ids, resolving the server module from the bundled `@volt/lsp-iec` (falling back to the sibling `volt-lsp-iec` workspace build). Graphical (VG) bodies aren't a separate file type — a TextMate **injection** (`vg.injection`) highlights `NETWORK…END_NETWORK` networks by content, so it lights up a whole graphical (FBD/LD) POU — a kind-named `.fb`/`.prg`/`.fun` file — **and** a graphical body inlined in a POU (e.g. a graphical method). The server routes each body to ST or VG analysis by the same `NETWORK` discriminator. `Volt: Restart Language Server` and `Volt: Show Language Server Output` drive it. Client config lives under the `volt.iec.*` namespace (a `volt.iec.server` path override + `diagnostics.*`/`vendor`/`trace` forwarded into the server's `initializationOptions`); the client reads no key the manifest doesn't declare, and the `structured-text` language id (a real IEC 61131-3 language) is not renamed. The Diagnostics summary filters on the LSP's own `source: "volt-lsp-iec"` (`SOURCE` in `panel.ts`) so non-Volt diagnostics never enter the count, and it defers to the host's native Problems panel rather than owning a diagnostics tree.

**Context keys** (`extension.ts`). There is **no** Volt status-bar item — the activity-bar container is Volt's ambient presence, and the views carry the state. (`lsp.ts` owns the one status-bar item there is: the LSP version, so a stale build is visible at a glance.) `updateContextKeys` drives the menu when-clauses off the shared `aggregate()` display model, worst-state-wins: `volt.workspaceInitialized`, `volt.bridgeOnline` (gates pull/push/build), `volt.bridgeOffline`. Bridge *lifecycle* (spawning/activating) is **not** the extension's job — it's the tray connector's; the extension selects, connects, disconnects and initializes against a reachable bridge.

**Agent** (`agent.ts`). The agent is the installed opencode — a prerequisite the extension resolves (bundled `volt`/opencode from the Volt install, else `volt` on PATH); it neither bundles nor downloads it. "Volt: Open Agent" opens/focuses an agent terminal.

## Commands

Build and package from the package directory (`packages/volt-vscode`):

```bash
# Type-check, then bundle the extension, the LSP server, and the volt CLI into dist/.
bun run build

# Build, then produce a .vsix marketplace package (vsce, no dependency tree).
bun run package
```

`package` runs `vsce package --no-dependencies`, producing `volt-<version>.vsix`. Reinstalling the **same** version string is a no-op for VS Code, so pass `--force` (below) when reinstalling the same build.

**Versioning:** this `version` must match `packages/volt-desktop/package.json` — Volt ships one number, and both `bun run release` and `release.yml` refuse a mismatch. Don't bump it alone to force a local reinstall; use `--force`. It lives in its own `package.json` only because the extension also publishes to the Marketplace independently.

Install the packaged extension into VS Code, Windsurf or Cursor (all take the same flag; the Volt installer runs exactly this per editor it finds on PATH):

```bash
code     --install-extension volt-vscode-<version>.vsix --force
windsurf --install-extension volt-vscode-<version>.vsix --force
cursor   --install-extension volt-vscode-<version>.vsix --force
```

## Compiler-warning settings

Volt mirrors CODESYS's project **Compiler warnings** dialog: each implemented code is a `volt.iec.diagnostics.<code>` 3-state setting (`off` / `warning` / `error`, default `warning`), so you can reproduce a project's exact configuration. Set them in Settings under **Volt › Iec › Diagnostics** (each setting names its `Cnnnn`), plus `volt.iec.diagnostics.deadCode` (a Volt-only switch, off by default).

Volt implements **21 of the ~66** dialog codes. The remaining 45 have no setting yet — Volt emits no diagnostic to configure. The full dialog list, what's implemented, and why the un-closeable gaps can't be, is [`../volt-lsp-iec/docs/codesys-reference/compiler-warnings-coverage.md`](../volt-lsp-iec/docs/codesys-reference/compiler-warnings-coverage.md).

## Layout

| Path | Role |
|---|---|
| `src/extension.ts` | `activate`/`deactivate`; wires the tree views, decorations, content provider, context keys, the connector poll, and the per-workspace `VoltStatus`; starts the LSP. No `setBundledCli` — `volt` is a PATH prerequisite the installer provides. |
| `src/commands.ts` | All `volt.*` command handlers — pull/push (with force confirmations), init, connect/disconnect, merge, build, refresh, open config/settings/reference. |
| `src/panel.ts` | The four Volt tree views (IDE Connection / IDE Sync / Diagnostics / Reference & Agent); `bridgeRoots` = the connection surface (detected projects → connect/disconnect), `syncRoots` = Incoming/Outgoing drift, each item a `vscode.diff` against `refs/remotes/volt/ide`. |
| `src/content.ts` | `volt://` content provider; resolves a ref's file via `volt show`. |
| `src/decorations.ts` | Explorer drift badges (`i`/`o`/`C`/`RO`) using the `volt.drift*` theme colors. |
| `src/workspace.ts` | The genuinely VS Code-specific helpers only (`workspaceFolders`, `hasVoltConfig`). `VoltStatus` lives in `@volt/control`. |
| `src/lsp.ts` | Starts the Volt LSP client for the ST-family languages. |
| `src/agent.ts` | Resolves the agent (installed opencode) binary for "Volt: Open Agent". |
| `languages/structured-text/` | TextMate grammar (`syntax.tmLanguage.json`) + language config (ST/ITF/GVL/DUT) + `vg.injection.tmLanguage.json` — the injection that highlights VG `NETWORK` networks by content. |
| `icons/` | File-kind icons and the `volt-icons` icon theme + activity-bar icon. |

## See also

- [`../volt-control/README.md`](../volt-control/README.md) — the shared TS control layer (`pull`/`push`/`status`/`show`, health, gates, the view-models) the extension calls.
- [`../volt-cli/README.md`](../volt-cli/README.md) — the `volt` CLI + the in-IDE bridges + the tray connector (one C# solution; absorbed the former `volt-git`/`volt-bridge`). A PATH prerequisite, not bundled here.
- [`../volt-lsp-iec/README.md`](../volt-lsp-iec/README.md) — the Structured Text **+ VG** language server.
- [`../volt-cli/docs/vg-language.md`](../volt-cli/docs/vg-language.md) — the **VG (Volt Graphical)** language spec.
- [`../../openspec/`](../../openspec/) — Volt design, roadmap, and decision log.
- [`../../CLAUDE.md`](../../CLAUDE.md) — repo-wide guidance and architecture.
