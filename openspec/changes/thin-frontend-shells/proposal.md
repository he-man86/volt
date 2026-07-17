## Why

The layering is already right in skeleton — `volt-git` (the volt CLI) owns all sync + bridge logic, `volt-control` is the UI-agnostic core, and `volt-vscode` / `volt-desktop` are meant to be thin renderers over it. But three kinds of logic leaked back up into both shells and were re-implemented twice, so the frontends drift and every fix must be made (and remembered) in two places. Two live bugs — a runaway `/refs` poll and a missing init-progress toast — are symptoms of the same erosion. And two structural rules that *should* hold have quietly slipped: the frontend should reach the bridge only for the cheap `/health` read (everything else through the CLI), and each user action should be **one** bridge call — but `pull` and `push` each do a redundant full-project `/refs` scan on top of their real call.

## What Changes

- **Bridge access boundary.** The volt CLI (`volt-git`) is the single abstraction for all bridge *data* operations (fetch/push/init/build/status). The frontend's *only* permitted direct-to-bridge call is the cheap `GET /health` poll in `volt-control`; no shell constructs any bridge call, and `volt-control` constructs no bridge data-plane call. (No connector proxy — the CLI already is the abstraction.)
- **One bridge call per action.** Collapse the redundant scans: `pull` derives everything from its single `/fetch` (drop the pre-`/refs`); `push` sends its single `/push` and reads the new state from the response it *already returns* (`newProjectVersion`/`newItems`) — dropping both the pre-`/refs` guard-scan (the sidecar supplies the `ifVersion` guards; the bridge rejects a stale push) and the post-`/refs` re-read. `init`→`/init` and `status`→`/refs` already single. The `/push` accepted response gains one *additive* optional field, `newFolders`, so the sidecar's folder map stays exact without a re-scan — additive, so no wire-version bump.
- **Shared per-workspace drift view-model** in `volt-control` (incoming/outgoing items with A/M/D tags, `paused` = mismatch‖merging, bound/initialized/port, `src/`-strip). Desktop's `snapshot()` and vscode's `syncRoots()/itemNodes()/bridgeRoots()` become thin renderers of it.
- **Shared outcome orchestration** in `volt-control`: pull/push outcome → a neutral `{ message, actions[] }` descriptor. Both shells render it with native dialogs instead of re-deriving conflict → open / refused → force / rejected → pull-first ‖ force.
- **Shared vendor↔port mapping** in `volt-control`; delete the two shell copies (`BRIDGE_PORT`, `vendorPort`, the `=== 8555` sniff).
- **Fix the `/refs` poll**: change-detection rides the existing cheap `/health` poll (a `projectDirty` edge), not a 4s full-project scan — so it also satisfies the health-only boundary above.
- **init progress parity**: thread `onProgress` through `volt-control`'s `init` and both shells via the already-existing NDJSON stream.

## Capabilities

### New Capabilities
- `frontend-shell-boundary`: The contract that the volt CLI is the sole bridge-data abstraction, the frontend touches the bridge only for `/health`, each action is one bridge call, and `volt-control` owns all drift projection / outcome orchestration / vendor-port mapping — leaving the two frontends as pure renderers with no duplicated logic.

### Modified Capabilities
<!-- none — no pre-existing openspec/specs/ capability tree (see CLAUDE.md: OpenSpec is changes/ only) -->

## Impact

- **`volt-git`**: `pull` drops the pre-`/fetch` `getRefs`; `push` drops both `getRefs` calls and reads `newProjectVersion`/`newItems`/`newFolders` from the `/push` response. `init` gains `onProgress` on `bridge.init(...)`; CLI `init` passes the reporter.
- **`volt-bridge`** (C#): `PushService`'s accepted result gains an *additive* `newFolders` map from its existing post-apply re-walk (it already computes per-item folders). No wire-version bump (additive optional). Written once in Core → identical on CODESYS and Beckhoff.
- **`volt-control`**: gains a per-workspace view-model + outcome-descriptor module + vendor/port helper; `events.ts` change-detection rewritten to poll `/health`; `actions.ts` `init` gains `onProgress`. `health.ts`'s `/health` probe is the one sanctioned direct bridge call.
- **`volt-vscode`** / **`volt-desktop`**: reduced to rendering the neutral models + native dialogs; local drift-shaping, outcome trees, and vendor/port literals deleted.
- **No new dependency.** No user-facing config change.
