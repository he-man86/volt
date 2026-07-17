## Context

`volt-control` already holds the UI-agnostic core (`VoltStatus`, `pull/push/build/init`, `healthDisplay`, `aggregate`, `collectDiagnostics`, IPC channel names). The intended layering — `volt-git` = sync/CLI logic, `volt-control` = core, shells = renderers — is in place. But three chunks of logic sit *above* the boundary, duplicated between `volt-vscode` and `volt-desktop`:

1. **Per-workspace drift projection.** `display.ts` has `aggregate()` for the *global* status-bar indicator only. The *per-workspace* projection is rebuilt twice: desktop `main.ts` (`Snap`/`snapshot`/`names`, lines 62–101) and vscode `panel.ts` (`syncRoots`/`itemNodes`/`bridgeRoots`). Both independently compute A/M/D tags, `paused = projectMismatch‖merging`, the `src/`-strip, port, and bound/initialized.
2. **Outcome orchestration.** vscode `commands.ts` carries the full pull/push outcome decision tree (conflict → open, refused → force-pull, rejected → pull-first ‖ force-push, plus force confirmations). Desktop's IPC handlers (`main.ts`) return raw outcomes, pushing the same decisions into `shell.html`'s renderer JS — duplicated or missing.
3. **Vendor↔port.** desktop `BRIDGE_PORT = { codesys: 8556, twincat: 8555 }`; vscode `vendorPort()`; the `readBridgePort(root) === 8555 ? "twincat" : "codesys"` sniff (both shells).

Two live bugs ride on this: the `/refs` poll (`events.ts` polls the ~10s full-project scan every 4s) and the missing init-progress toast (progress is threaded through pull/push/build but dropped for init at all four layers).

Two structural rules have also slipped. **Bridge access:** the entire frontend stack has only two direct-to-bridge HTTP calls, both in `volt-control` — `probeHealth` (`/health`) and `subscribeChanges` (`/refs`); vscode/desktop have none (they spawn the volt CLI for all data ops). So the volt CLI is *already* the bridge abstraction; the only leak is the `/refs` poll, which the poll-fix removes anyway. **Call count:** `pull` does `/health`+`/refs`+`/fetch` (the `/refs` is redundant — `/fetch` returns `projectVersion`/`items`/`changed`/`removed`/`folders`), and `push` does `/health`+`/refs`+`/push`+`/refs` (two full scans — the pre-scan guards drift/lease, the post-scan just re-reads the new version).

## Goals / Non-Goals

**Goals:**
- The volt CLI is the only path to the bridge data plane; the frontend's sole direct bridge call is `GET /health`.
- One heavy bridge call per action (drop the redundant `/refs` in pull and push).
- One `volt-control` per-workspace view-model; both shells render it, no field-level `StatusJson` shaping in a shell.
- One `volt-control` outcome descriptor; both shells render native dialogs from it.
- One vendor/port helper; delete the shell copies.
- Fix `/refs` change-detection once at the shared layer.
- init-progress parity via the existing NDJSON stream.

**Non-Goals:**
- No connector proxy / new gateway process — the CLI already is the abstraction.
- No new dependency.
- Not rewriting the shells' framework glue (VS Code tree providers, Electron windowing) — those legitimately stay per-shell.
- Not merging the two UIs into shared *pixels* — React vs SolidJS/native-tree stay separate; only the neutral models port.

## Decisions

### 0. Bridge boundary: the CLI is the abstraction; `/health` is the one exception

No connector proxy and no new gateway. The volt CLI already carries every bridge data op; the only frontend leak is `subscribeChanges`'s `/refs` poll, removed by decision 5. What remains — `probeHealth`'s `GET /health` — stays a direct HTTP GET on purpose: it is polled every few seconds (health dot + change detection + vendor gating), and spawning a CLI subprocess per poll would cost far more than a loopback GET. So the rule is: `volt-control` may issue `GET /health`; everything else goes through the CLI. Enforced by a grep-assert in tasks (no `/refs|/fetch|/push|/init|/build` or raw `127.0.0.1:855x` outside `health.ts`).

Alternative — a `volt health --json` CLI command so the frontend touches the bridge zero times — rejected: it turns a ~1ms loopback GET into a per-poll process spawn for no boundary benefit that matters (health is a read, not a mutation, and carries no git logic).

### 1. Collapse each action to one bridge call

The bridge is already built for this — the work is deleting redundant client-side scans, not adding endpoints.

`push` (`sync/push.ts`): the accepted `/push` response *already* returns `newProjectVersion` + `newItems` (`PushService` does a cold post-apply re-walk precisely "so the receipt matches the next `/refs` exactly"). So the post-push `getRefs()` (`push.ts:157`) is pure waste — read the receipt instead. The pre-push `getRefs()` guard-scan also goes on the normal path: the client already holds the sidecar `projectVersion`/`items`, which are exactly the `expectedProjectVersion` + per-item `ifVersion` guards `/push` takes; the bridge's `DetectConflicts` rejects a stale push, which maps to the same "pull first" outcome. The one gap is the sidecar's `folders` map — so `PushService`'s accepted result gains an **additive optional `newFolders`** built from the same re-walk (each `WalkItems` entry carries `it.Folder`). Additive ⇒ no `WIRE_VERSION` bump, old clients ignore it. Written once in Core ⇒ identical on CODESYS and Beckhoff.

`pull` (`sync/pull.ts`): delete the pre-`/fetch` `bridge.getRefs()`; compute `incoming` and the "already up to date" short-circuit from the single `fetchChanges()` response (it already returns `projectVersion`, `items`, `changed`, `removed`, `folders`).

The guard itself is preserved, not weakened: push already sends `expectedProjectVersion: sidecar.projectVersion`, and `DetectConflicts` rejects on mismatch — so the whole-project "IDE moved" check moves from a redundant client pre-scan to the bridge, which was enforcing it anyway. One required follow-up: today a version-mismatch rejection returns the raw conflict dump (`"the bridge rejected the push:\n <project>: …"`); `push.ts` must map a `<project>` version-mismatch conflict to the clean "the IDE changed since your last sync — run `volt pull` first" message so the outcome descriptor still reads well (the *actions* — Pull First / Force Push — already fire on any `rejected`).

Trade-offs:
- Dropping push's pre-scan means the "IDE changed" message loses its exact item *count* (the friendly message stays via the mapping above, just without "(N items)") — a cosmetic number that cost a full scan.
- The **force** path (`--force` / `--force-with-lease`) needs the IDE's *current* versions to clobber-guard against, and a lease needs the current `projectVersion` — so force keeps one read. Force is the rare path; the one-call rule targets the normal action.
- `dry-run` pull/push preview without mutating, so they keep a read call. The one-call rule governs the real action, not the preview.

### 2. A neutral per-workspace view-model in `volt-control/display.ts`

Add `projectWorkspace(vs: VoltStatus): WorkspaceView` returning a plain, Node-free record: `{ bound, initialized, workspaceRoot, port, health: HealthDisplay, paused: "mismatch" | "merging" | null, incoming: DriftItem[], outgoing: DriftItem[], error? }` where `DriftItem = { name, sub: "A"|"M"|"D", relPath }` (`relPath` already `src/`-stripped). `paused` is a discriminated reason, **not a boolean** — the bridge view renders different affordances for the two ("Accept project rename" for `mismatch`, "resolve in Git" for `merging`), so a single flag can't drive it. This is the union of what desktop `snapshot()` and vscode `itemNodes()/bridgeRoots()` compute. Shells map `WorkspaceView` → their widgets and nothing more; vscode still builds its own diff command (`vscode.diff`, `VOLTIDE↔BRIDGE`/`WORKSPACE`) from `DriftItem.relPath` + which array it's in — that's VS Code API, not shared data.

Why here: `display.ts` is already the "shaping lives once" module and is Node-free (importable by the sandboxed Solid renderer via the `/display` subpath). Alternative — a new module — rejected; same concern, more surface.

### 3. Outcome descriptors in a new `volt-control/outcomes.ts`

`describePull(outcome)` / `describePush(outcome)` return `{ tone, message, actions: OutcomeAction[] }` where `OutcomeAction` is a neutral tag (`"open-conflicts" | "force-pull" | "pull-first" | "force-push"`) plus a label and whether it needs a destructive confirm. The shells map each action tag to a native handler (VS Code `showWarningMessage` buttons; desktop dialog buttons wired back over IPC). The *decision* (which actions exist for which outcome, and the confirm copy) lives once.

Why a descriptor, not a callback: the shells own their dialog primitives (modal vs notification, button ordering), so `volt-control` returns data, not UI. Matches the existing `actions.ts` contract ("returns data/outcomes; the caller owns progress spinners and dialogs").

### 4. `vendorPort(vendor)` / `vendorForPort(port)` in `volt-control/health.ts`

`readBridgePort` already lives in `health.ts`; the fixed constants (`codesys: 8556`, `twincat: 8555`) belong beside it as one shared helper. The ports are fixed by CLAUDE.md and desktop already hardcodes exactly them, so vscode's `volt.bridge.codesysPort`/`twincatPort` configurable setting is removed — one constant, no knob. (Decided with the user: one port per vendor, no per-user override wanted.)

### 5. `/refs` change-detection → `/health` polling (`events.ts`)

Replace the 4s `GET /refs` poll with a cheap `GET /health` poll. `/health` is cache-only (off the IDE thread) and already fast. The bridge exposes no monotonic version, only a latching `projectDirty` bool, so `subscribeChanges` fires `onChange` on a **`projectDirty` false→true edge** (and on a `projectName` change, for rebind). `VoltStatus.refresh()` then does the one expensive `status` fetch — but only on an actual edge, not on a timer.

**Cadence — one unified `/health` poller, not two.** Today `VoltStatus` runs *two* health-touching timers: a 30s heartbeat (`HEALTH_MS`) that refreshes the health dot, and `subscribeChanges`'s 4s `/refs` timer. Since `/health` is cheap, collapse them into a **single ~4s `/health` poll** that both (a) updates `health` state and (b) detects the `projectDirty`/`projectName` edge. This keeps IDE-edit latency at ~4s (naively riding the 30s heartbeat instead would be a 7.5× regression) and removes a timer. Net in `status-tracker.ts`: the 30s heartbeat and the separate `subscribeChanges` timer both go; one `~4s` health tick drives health + change detection; the 3s mtime poll (local-file edits) stays. The per-call cost is a cached read + a lightweight async probe (3 property gets), so a 4s cadence never touches the STA thread with real work.

Alternatives considered:
- *Add a cheap `projectVersion` to `/health`* — cleanest UX (catches every edit), but CODESYS has no cheap version to compute; deriving one means re-scanning, i.e. the cost we're removing. Deferred; if the bridge later gains a real change counter, `subscribeChanges` swaps to it with no shell change.
- *Guard-in-flight + widen the interval* — still a periodic 10s STA-thread spike forever. Rejected.

Known limitation (documented, `ponytail:`-marked): a *second* IDE edit made while the project is already dirty won't auto-fire. The 3s local-file mtime poll, save-triggered refresh, and manual Refresh cover the remainder; nothing pins the IDE thread anymore. This is the honest trade for removing a runaway loop without a bridge change.

### 6. init progress via the existing stream

`actions.ts` `init` gains `onProgress?` and uses `spawnVoltProgress` when set (mirrors `pull`). The CLI `bin.ts` init case passes `rep.onProgress`, and `volt-git` `init()` calls `bridge.init(onProgress)` (the client already supports the NDJSON path). Shells pass a `progressBridge` exactly like push. No new plumbing — just opting init into paths that already exist.

## Risks / Trade-offs

- **Missed same-dirty-cycle edits** (decision 5) → mitigated by mtime poll + save-trigger + manual Refresh; upgrade path is a bridge change counter, isolated to `events.ts`.
- **Desktop renderer must gain the shared outcome actions** → verified: `shell.html`'s `doPull/doPush` today are `try { await volt.pull() } catch {}` — they swallow every outcome, so the desktop currently no-ops silently on a conflict/refuse/reject. This is net-new dialog UX (and fixes a latent bug), not a like-for-like move. The shared descriptor keeps it small.
- **TwinCAT `projectDirty` reliability** → the Beckhoff driver populates `projectDirty` (parity holds), but whether XAE flips it on every edit like CODESYS is unverified from source — smoke-tested in task 6.4. If XAE is laggy here, change-detection is duller on Beckhoff (never wrong, just slower to notice); the mtime poll + manual Refresh still cover it.
- **`console` build-on-Linux-only trap does not apply** — this change touches no `packages/console/*` file; it is all `volt-*`.
- **Regression surface**: the projection/outcome moves are behavior-preserving refactors; the risk is subtle drift (e.g. paused-state edge). Covered by a `volt-control` unit test asserting the projection matches the old per-shell output for representative `StatusJson` fixtures, and the `/refs`-quiet behavior gets a `subscribeChanges` test.

## Migration Plan

Land in `volt-control` first (view-model, outcomes, vendor/port, `events.ts` fix, `init` progress) with tests green, then cut each shell over to consume it and delete the dead local logic in the same PR (per CLAUDE.md: clean up strays as part of the change, not a follow-up). No data migration; no user-facing config change. Rollback is reverting the branch — the wire and `volt-git` are untouched.

## Open Questions

- None outstanding. (Resolved with the user: no connector proxy — the CLI is the abstraction; and vscode's port setting collapses to one fixed shared constant per vendor.)
