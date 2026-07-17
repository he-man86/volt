## 0. One bridge call per action (volt-git + volt-bridge)

- [x] 0.1 `volt-bridge`: add an **additive optional** `newFolders` map to `PushService`'s accepted result (built from the existing post-apply re-walk — each `WalkItems` entry has `it.Folder`); mirror in the TS `PushAcceptedSchema` + `openapi.yaml`. No `WIRE_VERSION` bump (additive). Core test (`PushServiceTests`) asserts `newFolders` present + parity with `newItems`. _(C# unwritten-env: builds/runs on Windows/CI — no .NET SDK here.)_
- [x] 0.2 `volt-git` `push.ts`: on the normal path drop the pre-push `getRefs()` (use the sidecar `projectVersion`/`items` as the guards — the already-sent `expectedProjectVersion` makes the bridge reject a stale push) and the post-push `getRefs()` (read `newProjectVersion`/`newItems`/`newFolders` from the response). Keep one read only on the `--force`/`--force-with-lease` path and for `dry-run`.
- [x] 0.2a `volt-git` `push.ts`: map a `<project>` version-mismatch rejection to the friendly "the IDE changed since your last sync — run `volt pull` first" reason (instead of the raw conflict dump). Mock aligned to the real bridge's `<project>` sentinel.
- [x] 0.3 `volt-git` `pull.ts`: drop the pre-`/fetch` `getRefs()`; compute `incoming` + the up-to-date short-circuit from the single `fetchChanges()` response. `dry-run` keeps a cheap `/refs`.
- [x] 0.4 `volt-git` tests (`sync.test.ts` 8b/8c): pull issues one `/fetch` and no `/refs`; a normal push issues one `/push` and no `/refs`; dry-run uses `/refs` not `/fetch`; stale-push still rejects with "pull first". All 48 offline tests green.

## 1. volt-control: shared models (land first, tests green)

- [x] 1.1 Added `projectWorkspace(input): WorkspaceView` to `display.ts` (Node-free; caller passes `port`). `paused` is a discriminated `"mismatch"|"merging"|null`; `DriftItem = { name, sub, relPath }` with `src/` stripped.
- [x] 1.2 Added `outcomes.ts`: `describePull`/`describePush` → `{ tone, message, actions }` with neutral tags (`open-conflicts`, `force-pull`, `pull-first`, `force-push`) + labels + `destructive`. Exported from `index.ts`.
- [x] 1.3 Added `BRIDGE_PORT` + `vendorPort(vendor)` + `vendorForPort(port)` to `health.ts`; exported.
- [x] 1.4 Unit test (`projection.test.ts`): `projectWorkspace` A/M/D + `src/`-strip + merging-wins-over-mismatch + not-initialized; outcome descriptors' tones/action tags.

## 2. volt-control: fix the /refs poll

- [x] 2.1 Deleted `events.ts` (`subscribeChanges`); folded IDE-change detection into `status-tracker`'s single ~4s `/health` poll — fires a refresh on a `projectDirty` false→true edge or `projectName` change. Dropped the separate 30s heartbeat + `/refs` timer. `ponytail:`-noted the same-dirty-cycle limit. Edge logic extracted to pure `isIdeChangeEdge`.
- [x] 2.2 Test (`status-tracker.test.ts`): `isIdeChangeEdge` fires on the dirty edge / project switch, not on first read / staying-dirty / save. Stale "no bridge polling" docs corrected.

## 3. volt-control: init progress

- [x] 3.1 `actions.ts` `init` gains `onProgress?` and uses `runCli`/`spawnVoltProgress` when set (mirror `pull`).
- [x] 3.2 `volt-git` `init()` takes `onProgress` → `bridge.init(onProgress)`; CLI `bin.ts` init case runs a `createReporter()`.

## 4. volt-vscode: become a renderer

- [x] 4.1 `views/panel.ts`: sync/bridge trees built from `projectWorkspace(...)` via a local `viewOf(s)`; `itemNodes`→`itemNode(DriftItem,…)` keeps only the `vscode.diff` command; `bridgeRoots` reads `v.health`/`v.port`/`v.paused === "mismatch"`.
- [x] 4.2 `commands.ts`: `presentOutcome` renders `describePull`/`describePush` via native dialogs; inline outcome tree deleted.
- [x] 4.3 `commands.ts`: `progressBridge` threaded into `init`; local `vendorPort` deleted for the shared helper; `volt.bridge.codesysPort`/`twincatPort` removed from `package.json`; `extension.ts` `probeVendors` uses the shared helper.

## 5. volt-desktop: become a renderer

- [x] 5.1 `main.ts`: `Snap`/`snapshot`/`names` replaced with `projectWorkspace(...)`; `BRIDGE_PORT` + the `=== 8555` sniff replaced by `vendorPort`/`vendorForPort`.
- [x] 5.2 `main.ts`: `runPull`/`runPush` + `presentOutcome` render the shared descriptor as native **Electron `dialog.showMessageBox`** (deviation from "renderer buttons over IPC" — less code, native modals; the desktop offers force/pull-first, drops `open-conflicts` since it has no merge editor). Fixes the old silent `catch {}`.
- [x] 5.3 `main.ts` `volt:init`: streams progress frames over IPC (`volt:initProgress`); `preload.cjs` exposes `onInitProgress`; `shell.html` shows the phase/percentage in the init row.

## 6. Verify + enforce the boundary

- [x] 6.1 Repo-wide `bun run typecheck` (10/10 packages exit 0) + `bun run lint` (0 errors); `volt-control` 32 tests + `volt-git` 48 offline tests green.
- [x] 6.2 Grep-assert clean: no `8555`/`8556` literal in the shells; no bridge data-plane call in the frontend stack (only `GET /health` in `health.ts`). Fixed a stray `extension.ts` read of the deleted settings.
- [ ] 6.3 `bun run compat` — needs an installed opencode + a built bridge (no .NET SDK here); run on the Windows/CI box. Expect green (additive field, no wire bump).
- [ ] 6.4 Manual (CODESYS + TwinCAT): init a large project from each shell → live progress toast; idle → bridge log shows no recurring `refs:` scans; IDE edit → drift view updates once. **Smoke-test TwinCAT XAE flips `projectDirty` on an edit** (CODESYS known-good; TC unverified).
- [ ] 6.5 Manual: confirm the desktop conflict/refuse/reject paths now surface a dialog (net-new UX, was `catch {}`).
