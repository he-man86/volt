## 1. Shared state machine + honest aggregate (volt-control)

- [ ] 1.1 Add `SyncMode` type + `syncMode(...)` in `src/view/workspace.ts` returning `unbound | init | offline | merging | mismatch | ready` (precedence merging > mismatch > offline > ready; init when not initialized but a project is available; unbound otherwise)
- [ ] 1.2 Expose `mode: SyncMode` on `WorkspaceView` and set it in `projectWorkspace(...)`
- [ ] 1.3 Fix `aggregate()` in `src/view/display.ts` to handle `unknown` (collapse into the not-connected/offline branch) so it never returns `insync`/"Connected" before a probe returns
- [ ] 1.4 Unit tests: `workspace.test`/`projection.test` cover each `mode` (esp. offline, merging-beats-offline, unknown→not-ready); `display.test` covers `aggregate(unknown)` → not `insync`
- [ ] 1.5 `bun typecheck` + `bun test` green in `packages/volt-control`

## 2. VS Code extension (volt-vscode)

- [ ] 2.1 `package.json`: remove `volt.connect` and `volt.disconnect` from the `view/title` menu of `volt.views.sync`
- [ ] 2.2 `package.json`: add a bridge-online gate to the `when` of `volt.pull`, `volt.push`, `volt.build`, `volt.forcePull`, `volt.forcePush` (new `volt.bridgeOnline` context key, or `&& !volt.bridgeOffline` once 1.3 makes it honest)
- [ ] 2.3 `extension.ts`: set the bridge-online context key from the (now honest) aggregate/`mode`; verify `volt.bridgeOffline` is true during the `unknown` window
- [ ] 2.4 `panel.ts`: render the Sync view from `view.mode`; ensure the offline state yields to the big Connect welcome (no blank view); dedupe redundant Connect surfaces
- [ ] 2.5 `commands.ts`: give `volt.disconnect` (if kept), `abortMerge`, `takeIdeVersion`, `takeMyVersion` a `ProgressLocation.Notification` indicator so all bridge actions match
- [ ] 2.6 `package.json`: remove the "Download Volt" link from the `viewsWelcome` "connector isn't running" entry (keep the informational "start Volt" guidance)
- [ ] 2.7 `extension.ts`: remove the status-bar item (`createStatusBarItem`) and its `updateGlobalUi` wiring; keep file decorations and the activity-bar views. Confirm no dangling references to the removed item
- [ ] 2.8 Update `panel.test.ts` for the removed icons + mode-driven rendering; `bun run build` (typecheck) + `bun test` green

## 3. Desktop (volt-desktop)

- [ ] 3.1 Ensure `WorkspaceView.mode` flows into the renderer `snap` (main-process status assembly)
- [ ] 3.2 `shell.html`: remove the `i-connect` and `i-disconnect` icons from `syncActs`; render the action row (pull/push/build/refresh) only in `ready` mode
- [ ] 3.3 `shell.html`: in the `offline` mode branch of `syncBody`, render a single big Connect button using the same `.init-row`/`.btn.primary` markup as the Init buttons; remove the big Connect from the Bridge section
- [ ] 3.4 `shell.html`: stop showing "✓ In sync with the IDE." when offline (drive the whole Sync body from `mode`)
- [ ] 3.5 `doDisconnect` handler + `volt:disconnect` IPC: remove or leave dormant (no button); update the stale `busy` comment
- [ ] 3.6 `bun typecheck` + `bun test src/panel.test.ts` green in `packages/volt-desktop`

## 4. Connector wire-contract guard (volt-cli)

- [ ] 4.1 Add a round-trip test: bridge serializes `InstancesResult` + `HealthResponse` via `Volt.Engine.Wire`; connector's `WireProjects`/`HealthProbe.FromWire` parse it; assert every field the connector relies on survives
- [ ] 4.2 `dotnet test` for the relevant connector/engine test project green

## 5. Outgoing detection + diff compare (done ahead of the redesign)

- [x] 5.1 Add a debounced `src/` watcher to `VoltStatus` (`volt-control/src/state/status.ts`) → refresh on tracked-file changes; both frontends + all edit sources
- [x] 5.2 Tests: `files.test.ts` pins the gap (mtime poll ignores src edits); `status.test.ts` confirms a src edit triggers refresh and non-source files don't
- [x] 5.3 Fix `Commands.Show`/`CmdShow` (`volt-cli`) to return exit 2 for an absent item (empty diff pane) vs exit 1 for a real error
- [x] 5.4 Tests: `ShowCommandTests` (HEAD↔BRIDGE incoming compare + absent-flag) and `BlackBoxTests` (exit codes) updated; `content.test.ts` (`volt-vscode`) pins exit-2 → empty pane

## 7. Verify end-to-end

- [ ] 7.1 Manual/behavior check: offline → both UIs show only Connect (no pull/push), Connect in the Init location, no Disconnect, no "in sync" while offline, status bar not "Connected" during probing
- [ ] 7.2 Root-level `bun run typecheck` + `bun run lint` green; commit + push to `dev`
