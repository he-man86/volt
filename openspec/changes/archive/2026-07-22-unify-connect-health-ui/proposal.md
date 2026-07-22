## Why

The two Volt frontends (the VS Code extension and the Electron desktop) each re-derive their own connect/health UI logic, and they disagree. The status bar can read "Connected and in sync with the IDE" before any bridge probe has returned; pull/push/build stay clickable while the bridge is offline and only fail after a round-trip; connect and disconnect appear as always-present small icons with different verbs for the same action; and the desktop shows "✓ In sync" while offline. The net effect is that **the UI looks connected even when it isn't**, and the two UIs behave differently for the same state.

## What Changes

- **Add a single shared state machine** in `@volt/control`: a derived `mode` on `WorkspaceView` (`unbound | init | offline | merging | mismatch | ready`), computed once so both shells render from one source of truth instead of re-deriving.
- **Gate all bridge actions on `online`.** When offline, pull/push/build are not shown/dispatched — the only action is Connect. **BREAKING** (UX): actions that used to be clickable-then-fail are now hidden until the bridge is online.
- **Remove the Disconnect button entirely** from both UIs. It only clears the connector's active-connection highlight, which the CLI never gates sync on, so it does nothing useful and confuses. The `volt.disconnect` command may remain palette-only.
- **One Connect surface, in the Init location.** When initialized-but-offline, show a single big Connect button in the *same location/style* as the Init button (Sync body). Remove the small connect/disconnect icons and the redundant duplicate Connect surfaces/verbs.
- **Fix the health aggregate.** `aggregate()` must treat the `unknown` (pre-probe) health kind as not-connected, so nothing reads as "Connected/in sync" before a probe returns, and the offline/Connect affordance renders during probing instead of a blank view.
- **Consistent loading indicators.** Every bridge action uses the same indicator per shell (extension: `ProgressLocation.Notification`; desktop: the `busy` note) — no action is left with no feedback.
- **Remove stray extension artifacts.** Delete the "Download Volt" `viewsWelcome` link (it appears unpredictably — only when a folder is un-initialized *and* the tray connector is down — and points a Volt-running user at the installer), and **remove the VS Code status-bar item** entirely (the activity-bar Volt container is the presence indicator; the status-bar section was the surface showing the false "Connected and in sync").
- **Auto-detect outgoing changes.** Add a debounced `src/` file watcher to the shared `VoltStatus` tracker so a workspace edit is detected however it's made — the agent's tools, a terminal, git, an external editor — and on the desktop, not just an in-editor save. Today detection rides only the extension's `onDidSaveTextDocument` (editor saves) + the `ide-refs.json` mtime poll (pull/push only), so agent/terminal edits require a manual refresh. *(Implemented.)*
- **Fix the diff-compare exit code.** `volt show` returns exit **2** (rendered as an empty pane) when an item is legitimately absent at a ref (an added/removed item in a diff), vs exit 1 for a genuine error. Previously every miss was exit 1, so an added incoming item's diff showed `"volt show failed: … not found at HEAD"` on the empty side instead of a blank pane. *(Implemented.)*
- **(Secondary) Pin the connector wire contracts.** Add a round-trip test guarding the three hand-mirrored wire shapes (`instances` DTOs, `select` body, `health` status vocabulary) against `Volt.Engine.Wire`, which currently have no shared type or test.

## Capabilities

### New Capabilities
- `ide-sync-ui`: the shared, UI-agnostic state machine and gating rules that decide what each Volt frontend shows for a bound workspace given its initialized/health/merge state — including the offline Connect flow, the removal of Disconnect, action gating on `online`, and the honest health aggregate.

### Modified Capabilities
<!-- None: the archived openspec/specs/ capability tree was removed; invariants live in package docs. This introduces one new capability spec. -->

## Impact

- **`packages/volt-control`** — `src/view/workspace.ts` (new `syncMode` + `WorkspaceView.mode`), `src/view/display.ts` (`aggregate()` `unknown` fix). New unit tests in `src/view/*.test.ts`.
- **`packages/volt-vscode`** — `package.json` menu `when` clauses (remove connect/disconnect from Sync title, gate pull/push/build on a bridge-online context key), the `viewsWelcome` "Download Volt" link removal, `src/panel.ts` (render from `mode`), `src/commands.ts` (indicator parity), `src/extension.ts` (remove the status-bar item + its `updateGlobalUi` wiring).
- **`packages/volt-desktop`** — `shell.html` (`render`/`syncActs`/`syncBody`: remove connect/disconnect icons, move Connect into the Sync body, gate the action row on `mode === "ready"`).
- **`packages/volt-cli`** — `Commands.Show`/`Program.cs` diff-compare exit-code fix (absent → exit 2) + `ShowCommandTests`/`BlackBoxTests`; (secondary) a connector↔engine wire round-trip test.
- **`packages/volt-control`** (also) — `src/state/status.ts` src-watcher for outgoing detection + `status.test.ts`/`files.test.ts`.
- **`packages/volt-vscode`** (also) — `src/content.test.ts` pins the diff content-provider (exit-2 → empty pane).
- No protocol/wire changes; no data-path changes. Purely presentation + one shared model field.
